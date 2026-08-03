import type { Deal, Prisma } from '@prisma/client';
import {
  COMMISSION_POLICY,
  type CommissionPayer,
  type DealActor,
  type DealStatus,
  availableActions,
  computeCommission,
  computePaymentBreakdown,
} from '@escrowuz/shared';
import { prisma } from '../db/prisma.js';
import { ApiError } from '../lib/errors.js';
import { getPaymentProvider } from '../payments/index.js';
import { escrowAmountOf, executeTransition, type TransitionContext } from './transition.js';
import { notifyDealCreated } from '../notifications/deal-notifications.js';

export interface CreateDealInput {
  readonly title: string;
  readonly description: string;
  readonly amountTiyin: bigint;
  readonly commissionPayer: CommissionPayer;
  /** Qarshi tomonning emaili. Yaratuvchi qaysi rolda ekaniga qarab belgilanadi. */
  readonly counterpartyEmail: string;
  /** Yaratuvchi o'zini kim deb belgilayapti. */
  readonly myRole: 'buyer' | 'seller';
}

/**
 * Savdo yaratadi.
 *
 * Summalar SERVERDA hisoblanadi (§11). Mijoz komissiyani yoki
 * "xaridor to'laydigan summa"ni yuborsa ham — e'tiborga olinmaydi.
 */
export async function createDeal(creatorId: string, input: CreateDealInput): Promise<Deal> {
  const counterparty = await prisma.user.findUnique({
    where: { email: input.counterpartyEmail.toLowerCase() },
    select: { id: true, deletedAt: true },
  });

  if (!counterparty || counterparty.deletedAt) {
    throw ApiError.badRequest(
      'Bunday foydalanuvchi topilmadi. U avval ro\'yxatdan o\'tishi kerak.',
    );
  }
  if (counterparty.id === creatorId) {
    throw ApiError.badRequest('O\'zingiz bilan savdo qila olmaysiz');
  }

  // Komissiya SERVERDA, joriy siyosat bo'yicha hisoblanadi va savdoga
  // MUZLATIB qo'yiladi — keyin siyosat o'zgarsa bu savdo ta'sirlanmaydi.
  const breakdown = computePaymentBreakdown(input.amountTiyin, input.commissionPayer);

  // Xaridor to'laydigan summa provayder chegarasiga sig'ishi kerak.
  // Buni SAVDO YARATISHDA tekshiramiz: to'lov paytida bilish juda kech,
  // ikkala tomon allaqachon kelishib bo'lgan bo'ladi.
  const limits = getPaymentProvider().limits;
  if (breakdown.buyerPaysTiyin > limits.maxAmountTiyin) {
    throw ApiError.badRequest(
      `Xaridor to'laydigan summa (${breakdown.buyerPaysTiyin / 100n} so'm) ` +
        `to'lov tizimi chegarasidan (${limits.maxAmountTiyin / 100n} so'm) oshib ketdi`,
    );
  }
  if (breakdown.buyerPaysTiyin < limits.minAmountTiyin) {
    throw ApiError.badRequest(
      `Xaridor to'laydigan summa kamida ${limits.minAmountTiyin / 100n} so'm bo'lishi kerak`,
    );
  }
  if (limits.requiresWholeSom && breakdown.buyerPaysTiyin % 100n !== 0n) {
    throw ApiError.badRequest(
      'To\'lov tizimi faqat butun so\'m qabul qiladi. Savdo summasini shunga moslang.',
    );
  }

  const isBuyer = input.myRole === 'buyer';

  // Yaratuvchi ismini tranzaksiyadan OLDIN olamiz — tranzaksiya ichidagi
  // har bir qo'shimcha so'rov qulfni uzoqroq ushlab turadi.
  const creator = await prisma.user.findUnique({
    where: { id: creatorId },
    select: { fullName: true },
  });

  // Savdo va taklif xabari BITTA tranzaksiyada: savdo yaratilmasa
  // taklif ham ketmaydi.
  return prisma.$transaction(async (tx) => {
    const deal = await tx.deal.create({
      data: {
        buyerId: isBuyer ? creatorId : counterparty.id,
        sellerId: isBuyer ? counterparty.id : creatorId,
        title: input.title,
        description: input.description,
        amountTiyin: input.amountTiyin,
        commissionTiyin: breakdown.commissionTiyin,
        commissionBps: COMMISSION_POLICY.rateBps,
        commissionPayer: input.commissionPayer,
        status: 'DRAFT',
      },
    });

    await notifyDealCreated(deal, creatorId, creator?.fullName ?? 'Hamkoringiz', tx);

    return deal;
  });
}

/** Foydalanuvchi shu savdoda kim — xaridormi, sotuvchimi, yoki begonami. */
export function roleInDeal(deal: Deal, userId: string, isAdmin: boolean): DealActor | null {
  if (deal.buyerId === userId) return 'buyer';
  if (deal.sellerId === userId) return 'seller';
  if (isAdmin) return 'admin';
  return null;
}

/**
 * Savdoni ruxsat tekshiruvi bilan o'qiydi (§11 — IDOR himoyasi).
 *
 * Begona savdo so'ralganda 403 emas, 404 qaytariladi: 403 "bunday savdo bor,
 * lekin sizniki emas" degan ma'lumotni oshkor qiladi va ID'larni sinab
 * ko'rish orqali savdolar mavjudligini aniqlash imkonini beradi.
 */
export async function getDealForUser(
  dealId: string,
  userId: string,
  isAdmin: boolean,
): Promise<{ deal: Deal; role: DealActor }> {
  const deal = await prisma.deal.findUnique({ where: { id: dealId } });
  if (!deal || deal.deletedAt) throw ApiError.notFound('Savdo topilmadi');

  const role = roleInDeal(deal, userId, isAdmin);
  if (!role) throw ApiError.notFound('Savdo topilmadi');

  // Admin faqat nizoli va to'lov nomuvofiqligi holatlarini ko'radi (§2).
  // Boshqa savdolarga aralashuvi mumkin emas.
  if (role === 'admin' && deal.status !== 'DISPUTED' && deal.status !== 'PAYMENT_MISMATCH') {
    throw ApiError.notFound('Savdo topilmadi');
  }

  return { deal, role };
}

export interface DealListFilter {
  readonly status?: DealStatus | undefined;
  readonly role?: 'buyer' | 'seller' | undefined;
  readonly limit: number;
  readonly cursor?: string | undefined;
}

export async function listDeals(userId: string, filter: DealListFilter): Promise<Deal[]> {
  const where: Prisma.DealWhereInput = { deletedAt: null };

  if (filter.role === 'buyer') where.buyerId = userId;
  else if (filter.role === 'seller') where.sellerId = userId;
  else where.OR = [{ buyerId: userId }, { sellerId: userId }];

  if (filter.status) where.status = filter.status;

  return prisma.deal.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: filter.limit,
    ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
  });
}

/**
 * To'lov havolasini yaratadi.
 *
 * Provayderga murojaat DB tranzaksiyasidan TASHQARIDA bo'ladi: tarmoq
 * so'rovi tranzaksiya ichida bo'lsa, u qatorlarni uzoq qulflab turadi.
 */
export async function createPaymentLink(
  dealId: string,
  userId: string,
  webBaseUrl: string,
): Promise<{ payUrl: string; invoiceId: string; amountTiyin: bigint }> {
  const { deal, role } = await getDealForUser(dealId, userId, false);

  if (role !== 'buyer') {
    throw ApiError.forbidden('To\'lovni faqat xaridor amalga oshiradi');
  }
  if (deal.status !== 'AWAITING_PAYMENT') {
    throw ApiError.invalidTransition(
      `To'lov faqat "to'lov kutilmoqda" holatida mumkin. Hozirgi holat: ${deal.status}`,
    );
  }

  // Mavjud hisob-faktura bo'lsa qaytaramiz — har bosishda yangisini
  // yaratsak, provayderda o'nlab "kutilayotgan" to'lov to'planib qolardi
  // va qaysi biri to'langanini kuzatish murakkablashardi.
  //
  // Lekin MUDDATI O'TGANINI qayta ishlatib bo'lmaydi: checkout.uz havolani
  // 1 soatdan keyin o'chiradi va xaridor "sahifa topilmadi" ni ko'rardi.
  const existing = await prisma.invoice.findFirst({
    where: {
      dealId: deal.id,
      paidAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date(Date.now() + 60_000) } }],
    },
    orderBy: { createdAt: 'desc' },
  });
  if (existing) {
    return {
      payUrl: existing.payUrl,
      invoiceId: existing.externalId,
      amountTiyin: existing.amountTiyin,
    };
  }

  const provider = getPaymentProvider();
  const amountTiyin = escrowAmountOf(deal);

  const invoice = await provider.createInvoice({
    dealId: deal.id,
    amountTiyin,
    returnUrl: `${webBaseUrl}/deals/${deal.id}`,
    webhookUrl: process.env['CHECKOUT_UZ_WEBHOOK_URL'] ?? `${webBaseUrl}/api/webhooks`,
    description: deal.title.slice(0, 200),
  });

  await prisma.invoice.create({
    data: {
      dealId: deal.id,
      provider: provider.name,
      externalId: invoice.invoiceId,
      amountTiyin,
      payUrl: invoice.payUrl,
      ...(invoice.expiresAt ? { expiresAt: invoice.expiresAt } : {}),
    },
  });

  return { payUrl: invoice.payUrl, invoiceId: invoice.invoiceId, amountTiyin };
}

/** Sotuvchi trek-raqam kiritadi. */
export async function shipDeal(
  dealId: string,
  userId: string,
  data: { carrier: string; trackingNumber: string; note?: string | undefined },
  ctx: Omit<TransitionContext, 'actor' | 'actorId'>,
): Promise<Deal> {
  const { deal, role } = await getDealForUser(dealId, userId, false);
  if (role !== 'seller') {
    throw ApiError.forbidden('Trek-raqamni faqat sotuvchi kiritadi');
  }

  const result = await executeTransition(deal.id, 'ship', {
    ...ctx,
    actorId: userId,
    actor: 'seller',
    metadata: { carrier: data.carrier, trackingNumber: data.trackingNumber },
    // Xaridorga ketadigan xabarda trek-raqam ko'rsatiladi
    shipment: { carrier: data.carrier, trackingNumber: data.trackingNumber },
  });

  await prisma.shipment.create({
    data: {
      dealId: deal.id,
      carrier: data.carrier,
      trackingNumber: data.trackingNumber,
      note: data.note ?? null,
    },
  });

  return result.deal;
}

/** Savdo sahifasi uchun to'liq ma'lumot. */
export async function getDealDetail(dealId: string, userId: string, isAdmin: boolean) {
  const { deal, role } = await getDealForUser(dealId, userId, isAdmin);

  const [buyer, seller, shipments, events, dispute] = await Promise.all([
    prisma.user.findUnique({
      where: { id: deal.buyerId },
      select: { id: true, fullName: true, email: true },
    }),
    prisma.user.findUnique({
      where: { id: deal.sellerId },
      select: { id: true, fullName: true, email: true },
    }),
    prisma.shipment.findMany({ where: { dealId }, orderBy: { shippedAt: 'desc' } }),
    prisma.dealEvent.findMany({
      where: { dealId },
      orderBy: { createdAt: 'asc' },
      include: { actor: { select: { fullName: true } } },
    }),
    prisma.dispute.findUnique({ where: { dealId } }),
  ]);

  const breakdown = computePaymentBreakdown(
    deal.amountTiyin,
    deal.commissionPayer,
    deal.commissionBps,
  );

  return {
    deal,
    role,
    buyer,
    seller,
    shipments,
    events,
    dispute,
    breakdown,
    // Frontend shu ro'yxatga qarab tugmalarni ko'rsatadi. Server baribir
    // har bir so'rovni qaytadan tekshiradi — bu faqat interfeys uchun.
    availableActions: availableActions(deal.status as DealStatus, role),
  };
}

/** Savdo yaratishdan oldin xaridorga ko'rsatiladigan hisob-kitob. */
export function previewAmounts(amountTiyin: bigint, payer: CommissionPayer) {
  return {
    breakdown: computePaymentBreakdown(amountTiyin, payer),
    commissionTiyin: computeCommission(amountTiyin),
  };
}
