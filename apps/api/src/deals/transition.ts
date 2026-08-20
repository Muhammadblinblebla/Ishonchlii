/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  SAVDO O'TISH DVIGATELI                                                  ║
 * ║                                                                          ║
 * ║  Savdoning holati FAQAT shu fayl orqali o'zgaradi.                       ║
 * ║  Hech qayerda `prisma.deal.update({ data: { status } })` yozilmaydi.     ║
 * ║                                                                          ║
 * ║  Har bir o'tish BITTA tranzaksiyada quyidagilarni bajaradi:              ║
 * ║    1. Savdoni QULFLAB o'qiydi        (FOR UPDATE — poyga holatiga qarshi)║
 * ║    2. Versiyani tekshiradi           (optimistik qulf)                   ║
 * ║    3. State machine'dan so'raydi     (if shartlar bilan emas)            ║
 * ║    4. Summalarni SERVERDA hisoblaydi (frontenddan kelganiga ishonmaydi)  ║
 * ║    5. Ledger yozuvlarini qo'shadi    (yig'indi = 0)                      ║
 * ║    6. Holatni va versiyani yangilaydi                                    ║
 * ║    7. deal_events ga tarix yozadi                                        ║
 * ║                                                                          ║
 * ║  Bittasi yiqilsa — hammasi bekor bo'ladi. Pul yozilib holat qolib        ║
 * ║  ketishi mumkin emas.                                                    ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

import type { Deal, Prisma } from '@prisma/client';
import {
  type DealAction,
  type DealActor,
  type DealStatus,
  checkTransition,
  computePaymentBreakdown,
  dealTypeRule,
  distributeFullRefund,
  distributeRefundKeepingCommission,
  distributeSplit,
  holdsEscrow,
  refundRuleFor,
  type RefundableStatus,
  WALLET_HOLD_HOURS,
} from '@escrowuz/shared';
import { prisma } from '../db/prisma.js';
import { ApiError } from '../lib/errors.js';
import * as ledger from '../ledger/ledger.service.js';
import { getPaymentProvider } from '../payments/index.js';
import { notifyTransition } from '../notifications/deal-notifications.js';

/**
 * Pul SOTUVCHIGA o'tadigan yakuniy holatlar.
 *
 * Aynan shularda 30 soatlik muzlatish yoziladi. Qaytarish holatlari
 * (`REFUNDED`, `RESOLVED_BUYER`) bu ro'yxatda YO'Q: u yerda pul xaridorga
 * qaytadi va darhol yechib olinadi — xaridorni ushlab turishning ma'nosi yo'q.
 */
const SELLER_RELEASE_STATUSES = new Set<DealStatus>([
  'DELIVERED',
  'AUTO_RELEASED',
  'RESOLVED_SELLER',
]);

/** Savdoga muzlatib qo'yilgan komissiya. */
function commissionOf(deal: Deal): bigint {
  return deal.commissionTiyin;
}

export interface TransitionContext {
  /** Amalni bajarayotgan foydalanuvchi. Fon vazifasi bo'lsa `null`. */
  readonly actorId: string | null;
  readonly actor: DealActor;
  readonly ipAddress?: string | undefined;
  readonly reason?: string | undefined;
  readonly metadata?: Prisma.InputJsonValue | undefined;
  /**
   * Ledger yozuvlari uchun idempotentlik kaliti.
   *
   * Bir xil kalit bilan takror chaqirilsa pul ikki marta o'tmaydi.
   * Berilmasa savdo ID + amal + versiyadan tuziladi — bu ham idempotent,
   * chunki versiya har o'tishdan keyin o'zgaradi.
   */
  readonly idempotencyKey?: string | undefined;
  /** Nizo bo'lib hal qilinganda xaridor ulushi (bazis punkt). */
  readonly buyerShareBps?: number | undefined;
  /** Optimistik qulf: mijoz ko'rgan versiya. Mos kelmasa 409. */
  readonly expectedVersion?: number | undefined;
  /** Xabarnomada trek-raqamni ko'rsatish uchun. */
  readonly shipment?: { carrier: string; trackingNumber: string } | undefined;
}

export interface TransitionResult {
  readonly deal: Deal;
  readonly previousStatus: DealStatus;
  /** Ledgerga yozildimi (har o'tish pul harakatlantirmaydi). */
  readonly ledgerTransactionId: string | null;
}

/**
 * Savdoni bir holatdan boshqasiga o'tkazadi.
 *
 * Bu funksiya tashqi dunyoga (to'lov provayderiga) MUROJAAT QILMAYDI —
 * tranzaksiya ichida tarmoq so'rovi qilish uni uzoq ushlab turadi va
 * tarmoq uzilsa baza tranzaksiyasi ham osilib qoladi. Provayder bilan
 * gaplashish bu funksiyadan OLDIN yoki KEYIN bo'ladi.
 */
export async function executeTransition(
  dealId: string,
  action: DealAction,
  ctx: TransitionContext,
): Promise<TransitionResult> {
  return prisma.$transaction(
    async (tx) => {
      // ── 1. Qulflab o'qish ─────────────────────────────────────────────────
      //
      // `FOR UPDATE` boshqa tranzaksiyalarni shu qator ustida kutishga
      // majbur qiladi. Busiz ikkita parallel "confirm" ikkalasi ham
      // "SHIPPED" ni ko'rib, pulni ikki marta o'tkazib yuborardi.
      //
      // Qulflash va o'qish BITTA so'rovda: alohida `findUnique` qo'shimcha
      // marta bazaga borish demak, tranzaksiya esa shuncha uzoq ochiq turadi.
      const locked = await tx.$queryRaw<Array<Record<string, unknown>>>`
        SELECT * FROM deals WHERE id = ${dealId}::uuid AND deleted_at IS NULL FOR UPDATE
      `;
      if (locked.length === 0) {
        throw ApiError.notFound('Savdo topilmadi');
      }

      const row = locked[0]!;
      const deal: Deal = {
        id: row['id'] as string,
        // Xaridor hali noma'lum bo'lishi mumkin (kalit so'z bilan yaratilgan
        // savdo hali band qilinmagan).
        buyerId: (row['buyer_id'] as string | null) ?? null,
        sellerId: row['seller_id'] as string,
        title: row['title'] as string,
        description: row['description'] as string,
        dealType: row['deal_type'] as Deal['dealType'],
        game: (row['game'] as string | null) ?? null,
        keyword: row['keyword'] as string,
        keywordNormalized: row['keyword_normalized'] as string,
        claimedAt: (row['claimed_at'] as Date | null) ?? null,
        amountTiyin: BigInt(String(row['amount_tiyin'])),
        commissionTiyin: BigInt(String(row['commission_tiyin'])),
        commissionBps: Number(row['commission_bps']),
        commissionPayer: row['commission_payer'] as Deal['commissionPayer'],
        currency: row['currency'] as string,
        status: row['status'] as Deal['status'],
        version: Number(row['version']),
        createdAt: row['created_at'] as Date,
        updatedAt: row['updated_at'] as Date,
        acceptedAt: (row['accepted_at'] as Date | null) ?? null,
        fundedAt: (row['funded_at'] as Date | null) ?? null,
        shippedAt: (row['shipped_at'] as Date | null) ?? null,
        completedAt: (row['completed_at'] as Date | null) ?? null,
        paymentDueAt: (row['payment_due_at'] as Date | null) ?? null,
        autoReleaseAt: (row['auto_release_at'] as Date | null) ?? null,
        deletedAt: (row['deleted_at'] as Date | null) ?? null,
      };
      const from = deal.status as DealStatus;

      // ── 2. Optimistik qulf ────────────────────────────────────────────────
      if (ctx.expectedVersion !== undefined && ctx.expectedVersion !== deal.version) {
        throw ApiError.conflict(
          'Savdo boshqa joyda o\'zgartirildi. Sahifani yangilab qayta urinib ko\'ring.',
          { expectedVersion: ctx.expectedVersion, actualVersion: deal.version },
        );
      }

      // ── 3. State machine ──────────────────────────────────────────────────
      const check = checkTransition(from, action, ctx.actor);
      if (!check.ok) {
        throw ApiError.invalidTransition(check.reason.message, {
          code: check.reason.code,
          from,
          action,
        });
      }
      const to = check.transition.to;

      // ── 4-5. Pul harakati ─────────────────────────────────────────────────
      const idempotencyKey =
        ctx.idempotencyKey ?? `deal:${dealId}:${action}:v${deal.version}`;

      const legs = buildLedgerLegs(deal, from, to, ctx);

      let ledgerTransactionId: string | null = null;
      if (legs.length > 0) {
        const posted = await ledger.post(
          { legs, idempotencyKey, dealId: deal.id },
          tx,
        );
        ledgerTransactionId = posted.transactionId;
      }

      // ── 6. Holatni yangilash ──────────────────────────────────────────────
      const now = new Date();
      const updated = await tx.deal.update({
        where: { id: dealId, version: deal.version },
        data: {
          status: to,
          version: { increment: 1 },
          ...timestampFor(to, now),
          ...timerFor(to, now, deal.dealType),
        },
      });

      // ── 6b. Hamyonda 30 soatlik muzlatish ─────────────────────────────────
      //
      // Pul `releaseLegs` orqali `user:<id>:holding` ga tushdi. Shu yozuv
      // uni qachon `available` ga ko'chirishni belgilaydi.
      //
      // AYNAN SHU TRANZAKSIYADA yoziladi: ledger yozuvi bo'lib, muzlatish
      // yozuvi bo'lmasa, pul `holding` da MANGU qolib ketardi — sotuvchi
      // uni hech qachon yecha olmasdi.
      if (SELLER_RELEASE_STATUSES.has(to)) {
        const sellerAmount = escrowAmountOf(deal) - commissionOf(deal);
        if (sellerAmount > 0n) {
          await tx.walletHold.upsert({
            where: { dealId: deal.id },
            // Takroriy o'tish bo'lsa (idempotentlik) — mavjudini o'zgartirmaymiz
            update: {},
            create: {
              userId: deal.sellerId,
              dealId: deal.id,
              amountTiyin: sellerAmount,
              releaseAt: new Date(now.getTime() + WALLET_HOLD_HOURS * HOUR),
            },
          });
        }
      }

      // ── 7. Tarix ──────────────────────────────────────────────────────────
      await tx.dealEvent.create({
        data: {
          dealId: deal.id,
          actorId: ctx.actorId,
          fromStatus: from,
          toStatus: to,
          action,
          reason: ctx.reason ?? null,
          ipAddress: ctx.ipAddress ?? null,
          // `exactOptionalPropertyTypes` yoqilgani uchun `undefined` ni
          // to'g'ridan-to'g'ri berib bo'lmaydi — maydonni butunlay tushiramiz.
          ...(ctx.metadata === undefined ? {} : { metadata: ctx.metadata }),
        },
      });

      // ── 8. Xabarnomalar ───────────────────────────────────────────────────
      //
      // Tranzaksiya ICHIDA navbatga qo'yiladi, yuborish esa fon vazifasida.
      // Shunda: tranzaksiya yiqilsa xat ketmaydi, SMTP sekin bo'lsa savdo
      // kutib turmaydi.
      await notifyTransition(
        {
          deal: updated,
          from,
          to,
          version: updated.version,
          reason: ctx.reason,
          shipment: ctx.shipment,
        },
        tx,
      );

      return { deal: updated, previousStatus: from, ledgerTransactionId };
    },
    {
      // Escrow uchun eng qattiq izolyatsiya. Sekinroq, lekin pul bilan
      // ishlashda tezlikdan ko'ra to'g'rilik muhimroq.
      isolationLevel: 'Serializable',
      timeout: 20_000,
    },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PUL HARAKATINI QURISH
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Savdoning xaridorini qaytaradi.
 *
 * Kalit so'z bilan yaratilgan savdo BAND QILINMAGUNCHA xaridorsiz turadi.
 * Pul harakati esa faqat to'lovdan keyin bo'ladi — ya'ni bu yerda xaridor
 * doim mavjud. Agar yo'q bo'lsa, bu ma'lumot buzilgani degani va pulni
 * harakatlantirishdan OLDIN to'xtaymiz.
 */
function requireBuyer(deal: Deal): string {
  if (!deal.buyerId) {
    throw new Error(
      `Ichki xato: ${deal.id} savdosida pul harakati kerak, lekin xaridor belgilanmagan`,
    );
  }
  return deal.buyerId;
}

function buildLedgerLegs(
  deal: Deal,
  from: DealStatus,
  to: DealStatus,
  ctx: TransitionContext,
): ledger.LedgerLeg[] {
  // Escrowda turgan summa = xaridor haqiqatda tushirgan summa.
  // Bu `amountTiyin` bilan bir xil EMAS: komissiya to'lovchisiga qarab
  // xaridor ko'proq to'lagan bo'lishi mumkin.
  const breakdown = breakdownOf(deal);
  const escrow = breakdown.escrowTiyin;
  const commission = deal.commissionTiyin;

  switch (to) {
    // ── Pul kirdi ─────────────────────────────────────────────────────────
    case 'FUNDED':
      // `PAYMENT_MISMATCH → FUNDED` da pul allaqachon kirgan (admin tasdiqladi),
      // qayta yozilmaydi.
      if (from === 'PAYMENT_MISMATCH') return [];
      // Provayder nomi ledger hisobiga yoziladi (`external:click`).
      // Qattiq yozilmaydi: provayder almashsa eski yozuvlar o'z nomida
      // qoladi, yangilari yangi nom bilan ketadi — hisobot to'g'ri chiqadi.
      return ledger.depositLegs(
        deal.sellerId,
        escrow,
        breakdown.providerFeeTiyin,
        getPaymentProvider().name,
      );

    // ── Pul sotuvchiga ────────────────────────────────────────────────────
    case 'DELIVERED':
    case 'AUTO_RELEASED':
    case 'RESOLVED_SELLER':
      return ledger.releaseLegs(deal.sellerId, escrow, escrow - commission, commission);

    // ── Pul xaridorga ─────────────────────────────────────────────────────
    case 'REFUNDED':
    case 'RESOLVED_BUYER': {
      // Pul qaytarish uchun xaridor kerak. Bu yerga faqat to'lovdan KEYIN
      // kelinadi, ya'ni xaridor allaqachon ma'lum — lekin tekshiramiz:
      // xaridorsiz qaytarish puli qayerga ketishini hech kim bilmasdi.
      const buyerId = requireBuyer(deal);
      const rule = refundRuleFor(to as RefundableStatus);
      const dist =
        rule === 'keep_commission'
          ? distributeRefundKeepingCommission(escrow, commission)
          : distributeFullRefund(escrow);

      return ledger.refundLegs(
        buyerId,
        deal.sellerId,
        escrow,
        dist.toBuyerTiyin,
        dist.toSellerTiyin,
        dist.toPlatformTiyin,
      );
    }

    // ── Bo'lib berish ─────────────────────────────────────────────────────
    case 'RESOLVED_SPLIT': {
      const buyerId = requireBuyer(deal);
      if (ctx.buyerShareBps === undefined) {
        throw ApiError.badRequest('Bo\'lish uchun xaridor ulushi (buyerShareBps) ko\'rsatilmagan');
      }
      const takeCommission = refundRuleFor('RESOLVED_SPLIT') === 'take_commission';
      const dist = distributeSplit(escrow, ctx.buyerShareBps, commission, takeCommission);

      return ledger.refundLegs(
        buyerId,
        deal.sellerId,
        escrow,
        dist.toBuyerTiyin,
        dist.toSellerTiyin,
        dist.toPlatformTiyin,
      );
    }

    // ── Pul tushmagan holatlar ────────────────────────────────────────────
    case 'CANCELLED':
    case 'EXPIRED':
      // Escrowda pul bo'lsa oddiy bekor qilish mumkin emas — state machine
      // buni allaqachon to'sadi, lekin ikkinchi qavat sifatida tekshiramiz.
      if (holdsEscrow(from)) {
        throw new Error(
          `Ichki xato: ${from} holatida escrowda pul bor, lekin ${to} ga o'tilmoqda`,
        );
      }
      return [];

    default:
      return [];
  }
}

/**
 * Savdoning to'liq pul taqsimoti.
 *
 * Hisob-kitob `money.ts` dagi `computePaymentBreakdown` ga topshiriladi —
 * uni bu yerda qayta yozish mumkin edi, lekin ikki nusxa vaqt o'tib
 * ajralib ketadi va o'shanda qaysi biri to'g'ri ekani noma'lum bo'lardi.
 *
 * Savdo yaratilgan paytdagi komissiya stavkasi ishlatiladi (`commissionBps`),
 * hozirgi siyosatdagi emas — siyosat o'zgarsa eski savdolar o'z shartlarini
 * saqlab qolishi kerak.
 */
export function breakdownOf(deal: Deal) {
  const breakdown = computePaymentBreakdown(
    deal.amountTiyin,
    deal.commissionPayer,
    deal.commissionBps,
  );

  // Saqlangan komissiya bilan qayta hisoblangani mos kelmasa — savdo yozuvi
  // buzilgan. Pul harakatlantirishdan oldin to'xtaymiz.
  if (breakdown.commissionTiyin !== deal.commissionTiyin) {
    throw new Error(
      `Savdo ${deal.id}: saqlangan komissiya (${deal.commissionTiyin}) qayta ` +
        `hisoblangani (${breakdown.commissionTiyin}) bilan mos emas`,
    );
  }

  return breakdown;
}

/**
 * ESCROWDA turgan summa — bizning balansimizga haqiqatda tushgani.
 *
 * Bu xaridor to'lagan summadan KAM: to'lov tizimi o'z ulushini ushlab qoladi.
 * Sotuvchiga va platformaga aynan shu summadan to'lanadi.
 */
export function escrowAmountOf(deal: Deal): bigint {
  return breakdownOf(deal).escrowTiyin;
}

/**
 * Xaridor kartasidan yechiladigan summa (to'lov komissiyasi bilan).
 *
 * Hisob-faktura shu summaga yaratiladi va webhook ham shuni tasdiqlaydi.
 */
export function chargedAmountOf(deal: Deal): bigint {
  return breakdownOf(deal).buyerPaysTiyin;
}

// ─────────────────────────────────────────────────────────────────────────────
// VAQT BELGILARI VA TIMERLAR
// ─────────────────────────────────────────────────────────────────────────────

function timestampFor(to: DealStatus, now: Date): Partial<Prisma.DealUpdateInput> {
  switch (to) {
    case 'AWAITING_PAYMENT':
      return { acceptedAt: now };
    case 'FUNDED':
      return { fundedAt: now };
    case 'SHIPPED':
      return { shippedAt: now };
    case 'DELIVERED':
    case 'AUTO_RELEASED':
    case 'RESOLVED_BUYER':
    case 'RESOLVED_SELLER':
    case 'RESOLVED_SPLIT':
    case 'REFUNDED':
    case 'CANCELLED':
    case 'EXPIRED':
      return { completedAt: now };
    default:
      return {};
  }
}

const HOUR = 60 * 60 * 1000;

/**
 * Timerlarni o'rnatadi va O'CHIRADI.
 *
 * §7 talabi: nizo ochilganda barcha timerlar to'xtaydi. Bu yerda
 * `autoReleaseAt = null` qilinadi — fon vazifasi `NULL` qiymatli
 * savdolarni umuman ko'rmaydi.
 */
function timerFor(
  to: DealStatus,
  now: Date,
  dealType: Deal['dealType'],
): Partial<Prisma.DealUpdateInput> {
  switch (to) {
    case 'AWAITING_PAYMENT':
      // §6: to'lov muddati 48 soat
      return { paymentDueAt: new Date(now.getTime() + 48 * HOUR), autoReleaseAt: null };

    case 'FUNDED':
      return { paymentDueAt: null, autoReleaseAt: null };

    case 'SHIPPED': {
      // Muddat SAVDO TURIGA bog'liq: jismoniy tovar 7 kun (pochta yo'lda
      // ketadi), o'yin akkaunti 3 kun (topshirish bir zumda bo'ladi).
      // Aniq qiymat `packages/shared/src/deal-types.ts` da.
      const hours = dealTypeRule(dealType).autoReleaseHours;
      return { autoReleaseAt: new Date(now.getTime() + hours * HOUR), paymentDueAt: null };
    }

    case 'DISPUTED':
      // ⚠️ ENG MUHIM QATOR: nizo ochilganda auto-release timeri O'CHADI.
      // Busiz 7 kun o'tgach fon vazifasi pulni sotuvchiga o'tkazib yuborardi —
      // nizo hal qilinmagan bo'lsa ham.
      return { autoReleaseAt: null, paymentDueAt: null };

    case 'PAYMENT_MISMATCH':
      return { autoReleaseAt: null, paymentDueAt: null };

    default:
      // Yakuniy holatlarda timerlar keraksiz
      return { autoReleaseAt: null, paymentDueAt: null };
  }
}
