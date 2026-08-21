import type { Deal, Prisma } from '@prisma/client';
import {
  COMMISSION_POLICY,
  type CommissionPayer,
  type DealActor,
  type DealStatus,
  type ContentKind,
  type DealType,
  availableActions,
  computeCommission,
  computePaymentBreakdown,
  credentialsVisibleIn,
  normalizeKeyword,
  usesChat,
  usesContent,
  validateKeyword,
} from '@escrowuz/shared';
import { prisma } from '../db/prisma.js';
import { STANDARD_TX } from '../db/tx-options.js';
import { ApiError } from '../lib/errors.js';
import { decryptSecret, encryptSecret } from '../lib/crypto.js';
import { getPaymentProvider } from '../payments/index.js';
import { chargedAmountOf, executeTransition, type TransitionContext } from './transition.js';
import { notifyDealClaimed } from '../notifications/deal-notifications.js';

export interface CreateDealInput {
  readonly title: string;
  readonly description: string;
  readonly amountTiyin: bigint;
  readonly commissionPayer: CommissionPayer;
  /** Nima sotilyapti. Topshirish usuli va auto-release muddati shunga bog'liq. */
  readonly dealType: DealType;
  /**
   * KALIT SO'Z — xaridor savdoni shu orqali topadi.
   *
   * Sotuvchi o'ylab topadi va xaridorga aytadi. Xaridorning emailini
   * oldindan bilish SHART EMAS.
   */
  readonly keyword: string;
}

/**
 * Savdo yaratadi. Yaratuvchi doim SOTUVCHI.
 *
 * Xaridor bu paytda NOMA'LUM: savdo kalit so'z bilan yaratiladi va
 * "band qilinmagan" holatda turadi. Xaridor kalit so'zni kiritib
 * `claimDeal` orqali savdoni ochadi.
 *
 * Summalar SERVERDA hisoblanadi (§11). Mijoz komissiyani yoki
 * "xaridor to'laydigan summa"ni yuborsa ham — e'tiborga olinmaydi.
 */
export async function createDeal(sellerId: string, input: CreateDealInput): Promise<Deal> {
  const check = validateKeyword(input.keyword);
  if (!check.ok) throw ApiError.badRequest(check.error);
  const keyword = check.value;
  const keywordNormalized = normalizeKeyword(keyword);

  // Komissiya SERVERDA, joriy siyosat bo'yicha hisoblanadi va savdoga
  // MUZLATIB qo'yiladi — keyin siyosat o'zgarsa bu savdo ta'sirlanmaydi.
  const breakdown = computePaymentBreakdown(input.amountTiyin, input.commissionPayer);

  // Xaridor to'laydigan summa provayder chegarasiga sig'ishi kerak.
  // Buni SAVDO YARATISHDA tekshiramiz: to'lov paytida bilish juda kech.
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

  try {
    return await prisma.deal.create({
      data: {
        buyerId: null, // xaridor hali noma'lum
        sellerId,
        title: input.title,
        description: input.description,
        dealType: input.dealType,
        // Hozircha faqat eFootball. Boshqa turlarda o'yin nomi ma'nosiz.
        game: input.dealType === 'GAME_ACCOUNT' ? 'eFootball' : null,
        keyword,
        keywordNormalized,
        amountTiyin: input.amountTiyin,
        commissionTiyin: breakdown.commissionTiyin,
        commissionBps: COMMISSION_POLICY.rateBps,
        commissionPayer: input.commissionPayer,
        status: 'DRAFT',
      },
    });
  } catch (err) {
    // Qisman unique indeks: band qilinmagan savdolar orasida kalit so'z noyob.
    if (isUniqueViolation(err)) {
      throw ApiError.badRequest(
        'Bu kalit so\'z band — boshqa ochiq savdoda ishlatilyapti. Boshqasini tanlang.',
      );
    }
    throw err;
  }
}

/**
 * Kalit so'z bo'yicha OCHIQ savdoni topadi.
 *
 * Xaridor to'lashdan oldin nima sotib olayotganini va qancha to'lashini
 * ko'radi. Bu yerda hech narsa band qilinmaydi — faqat ko'rsatiladi.
 */
export async function findByKeyword(keyword: string, viewerId: string) {
  const deal = await prisma.deal.findFirst({
    where: {
      keywordNormalized: normalizeKeyword(keyword),
      buyerId: null,
      status: 'DRAFT',
      deletedAt: null,
    },
    include: { seller: { select: { id: true, fullName: true } } },
  });

  if (!deal) {
    throw ApiError.notFound(
      'Bunday kalit so\'z bilan ochiq savdo topilmadi. Sotuvchidan qayta so\'rang.',
    );
  }
  if (deal.sellerId === viewerId) {
    throw ApiError.badRequest('Bu sizning o\'z savdongiz — o\'zingizdan sotib ololmaysiz.');
  }

  return {
    deal,
    breakdown: computePaymentBreakdown(
      deal.amountTiyin,
      deal.commissionPayer,
      deal.commissionBps,
    ),
  };
}

/**
 * Xaridor savdoni BAND QILADI va to'lovga o'tadi.
 *
 * ⚠️ Poyga holati: ikki xaridor bir vaqtda bir xil kalit so'zni kiritishi
 * mumkin. Faqat BITTASI band qilishi kerak, aks holda ikkalasi ham
 * to'lab, sotuvchi bitta tovar uchun ikki marta pul olardi.
 *
 * Himoya: `updateMany` `buyer_id IS NULL` sharti bilan. Baza qatorni
 * atomik yangilaydi — ikkinchi so'rov 0 qator o'zgartiradi va rad etiladi.
 */
export async function claimDeal(dealId: string, buyerId: string): Promise<Deal> {
  const existing = await prisma.deal.findUnique({
    where: { id: dealId },
    select: { sellerId: true, buyerId: true, status: true, deletedAt: true },
  });

  if (!existing || existing.deletedAt) throw ApiError.notFound('Savdo topilmadi');
  if (existing.sellerId === buyerId) {
    throw ApiError.badRequest('O\'zingizdan sotib ololmaysiz');
  }
  if (existing.buyerId) {
    throw ApiError.conflict('Bu savdoni boshqa xaridor allaqachon ochgan');
  }

  const claimed = await prisma.deal.updateMany({
    where: { id: dealId, buyerId: null, status: 'DRAFT', deletedAt: null },
    data: { buyerId, claimedAt: new Date() },
  });

  if (claimed.count === 0) {
    // Bizdan oldin boshqa xaridor ulgurdi.
    throw ApiError.conflict('Bu savdoni boshqa xaridor allaqachon ochgan');
  }

  // Band qilingach darhol to'lov bosqichiga o'tamiz — xaridor kalit so'zni
  // kiritganda allaqachon sotib olishga qaror qilgan.
  const buyer = await prisma.user.findUnique({
    where: { id: buyerId },
    select: { fullName: true },
  });

  const result = await executeTransition(dealId, 'accept', {
    actorId: buyerId,
    actor: 'buyer',
  });

  // Sotuvchiga xabar: savdongizni kimdir ochdi.
  await prisma.$transaction(async (tx) => {
    await notifyDealClaimed(
      result.deal,
      result.deal.sellerId,
      buyer?.fullName ?? 'Xaridor',
      tx,
    );
  }, STANDARD_TX);

  return result.deal;
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
  // Xaridor kartasidan YECHILADIGAN summa — to'lov tizimi komissiyasi bilan.
  // Escrowga bundan kamrog'i tushadi, farqni provayder ushlab qoladi.
  const amountTiyin = chargedAmountOf(deal);

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

/** Sotuvchi trek-raqam kiritadi (jismoniy tovar). */
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
  if (deal.dealType !== 'PHYSICAL') {
    throw ApiError.badRequest('Bu savdo jismoniy tovar uchun emas — trek-raqam kerak emas');
  }

  const result = await executeTransition(deal.id, 'ship', {
    ...ctx,
    actorId: userId,
    actor: 'seller',
    metadata: { carrier: data.carrier, trackingNumber: data.trackingNumber },
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

/**
 * eFootball: sotuvchi "akkauntni topshirdim" deb belgilaydi.
 *
 * Akkaunt ma'lumotlari CHATDA o'tkaziladi — bu yerda hech narsa
 * saqlanmaydi. Tugma faqat holatni o'zgartiradi va xaridorga
 * "tekshirib tasdiqlang" xabarini yuboradi.
 *
 * Sotuvchi haqiqatan yuborganini tekshira olmaymiz. Lekin xaridor
 * tasdiqlamaguncha pul o'tmaydi, va nizoda chat yozishmalari dalil
 * bo'ladi — shuning uchun soxta "topshirdim" sotuvchiga foyda bermaydi.
 */
export async function markHandedOver(
  dealId: string,
  userId: string,
  ctx: Omit<TransitionContext, 'actor' | 'actorId'>,
): Promise<Deal> {
  const { deal, role } = await getDealForUser(dealId, userId, false);
  if (role !== 'seller') {
    throw ApiError.forbidden('Buni faqat sotuvchi belgilaydi');
  }
  if (!usesChat(deal.dealType)) {
    throw ApiError.badRequest('Bu savdo turida topshirish boshqacha rasmiylashtiriladi');
  }

  const result = await executeTransition(deal.id, 'ship', {
    ...ctx,
    actorId: userId,
    actor: 'seller',
    metadata: { handover: 'chat' },
  });

  return result.deal;
}

/** Raqamli mahsulot: havola, matn yoki fayl. */
export interface DigitalPayload {
  readonly kind: ContentKind;
  /** `link`/`text` uchun qiymatning o'zi, `file` uchun saqlash kaliti. */
  readonly value: string;
  readonly fileName?: string | undefined;
  readonly fileSize?: number | undefined;
  readonly fileMime?: string | undefined;
}

/**
 * Sotuvchi raqamli mahsulotni topshiradi.
 *
 * Ikki muhim qoida:
 *
 *  1. Ma'lumot SHIFRLANGAN holda saqlanadi — bazani ko'rgan odam ham
 *     havolani yoki matnni o'qiy olmaydi.
 *
 *  2. Yozuv holat o'zgarishidan OLDIN qo'yiladi. Aks holda holat
 *     "topshirildi" bo'lib, ma'lumot yozilmay qolsa — xaridor bo'sh
 *     sahifani ko'radi, tasdiqlash taymeri esa ishlab ketaveradi va
 *     1 soatdan keyin pul sotuvchiga o'tib ketardi.
 */
export async function handoverContent(
  dealId: string,
  userId: string,
  payload: DigitalPayload,
  ctx: Omit<TransitionContext, 'actor' | 'actorId'>,
): Promise<Deal> {
  const { deal, role } = await getDealForUser(dealId, userId, false);
  if (role !== 'seller') {
    throw ApiError.forbidden('Mahsulotni faqat sotuvchi topshiradi');
  }
  if (!usesContent(deal.dealType)) {
    throw ApiError.badRequest('Bu savdo raqamli mahsulot uchun emas');
  }
  if (deal.status !== 'FUNDED') {
    throw ApiError.invalidTransition(
      `Mahsulotni faqat pul kelgandan keyin topshirish mumkin. Hozirgi holat: ${deal.status}`,
    );
  }

  try {
    await prisma.digitalContent.create({
      data: {
        dealId: deal.id,
        kind: payload.kind,
        payloadCipher: encryptSecret(payload.value),
        fileName: payload.fileName ?? null,
        fileSize: payload.fileSize ?? null,
        fileMime: payload.fileMime ?? null,
      },
    });
  } catch (err) {
    // Takroriy so'rov (ikki marta bosish). Yozuv allaqachon bor —
    // YANGI ma'lumot eskisini ALMASHTIRMAYDI.
    if (!isUniqueViolation(err)) throw err;
  }

  const result = await executeTransition(deal.id, 'ship', {
    ...ctx,
    actorId: userId,
    actor: 'seller',
    // Havola/matn METADATAGA yozilmaydi: `deal_events` append-only va
    // ochiq — u yerga tushgan sir hech qachon o'chmaydi.
    metadata: { handover: 'content', kind: payload.kind },
  });

  return result.deal;
}

/**
 * Xaridor raqamli mahsulotni ochib ko'radi.
 *
 * `readCredentials` bilan bir xil ruxsat qoidalari.
 */
export async function readContent(dealId: string, userId: string) {
  const { deal, role } = await getDealForUser(dealId, userId, false);

  if (role !== 'buyer') {
    throw ApiError.forbidden('Mahsulotni faqat xaridor ko\'ra oladi');
  }
  if (!credentialsVisibleIn(deal.status)) {
    throw ApiError.forbidden(
      deal.status === 'FUNDED' || deal.status === 'AWAITING_PAYMENT' || deal.status === 'DRAFT'
        ? 'Sotuvchi hali mahsulotni topshirmagan'
        : 'Bu savdo bo\'yicha mahsulot endi ko\'rsatilmaydi',
    );
  }

  const content = await prisma.digitalContent.findUnique({ where: { dealId } });
  if (!content) throw ApiError.notFound('Mahsulot topilmadi');

  // Birinchi ochilgan vaqtni yozib qo'yamiz — nizoda dalil.
  const viewedAt = content.viewedAt ?? new Date();
  if (!content.viewedAt) {
    await prisma.digitalContent.update({ where: { dealId }, data: { viewedAt } });
  }

  return {
    kind: content.kind,
    value: decryptSecret(content.payloadCipher),
    fileName: content.fileName,
    fileSize: content.fileSize,
    fileMime: content.fileMime,
    viewedAt,
  };
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002'
  );
}

/** Savdo sahifasi uchun to'liq ma'lumot. */
export async function getDealDetail(dealId: string, userId: string, isAdmin: boolean) {
  const { deal, role } = await getDealForUser(dealId, userId, isAdmin);

  const [buyer, seller, shipments, events, dispute, content] = await Promise.all([
    // Xaridor hali noma'lum bo'lishi mumkin (savdo band qilinmagan).
    deal.buyerId
      ? prisma.user.findUnique({
          where: { id: deal.buyerId },
          select: { id: true, fullName: true, email: true },
        })
      : Promise.resolve(null),
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
    // DIQQAT: `payloadCipher` bu yerda TANLANMAYDI. Savdo sahifasi hamma
    // uchun ochiq (xaridor, sotuvchi, nizoda admin) — shifrlangan bo'lsa
    // ham sirni javobga qo'shishning hojati yo'q. Ochiq qiymat faqat
    // alohida `/content` endpointidan, faqat xaridorga chiqadi.
    prisma.digitalContent.findUnique({
      where: { dealId },
      select: { createdAt: true, viewedAt: true, kind: true, fileName: true, fileSize: true },
    }),
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
    // Faqat "topshirildimi va xaridor ko'rdimi" — ma'lumotning o'zi emas.
    content,
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
