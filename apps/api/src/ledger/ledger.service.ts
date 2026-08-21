/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  LEDGER — PUL YOZISHNING YAGONA DARVOZASI                                ║
 * ║                                                                          ║
 * ║  `ledger_entries` jadvaliga FAQAT shu fayl orqali yoziladi.              ║
 * ║  Boshqa modul `prisma.ledgerEntry.create()` chaqirmasligi kerak.         ║
 * ║                                                                          ║
 * ║  Uch qavatli himoya:                                                     ║
 * ║   1. Bu yerda — yig'indi 0 emasligi tekshiriladi                        ║
 * ║   2. Bazada  — DEFERRABLE trigger COMMIT paytida rad etadi              ║
 * ║   3. CI'da   — `npm run ledger:check` butun jadvalni tekshiradi          ║
 * ║                                                                          ║
 * ║  Uchtasi ham bir xil narsani tekshiradi. Bu ortiqchalik ataylab:         ║
 * ║  har qavat boshqa turdagi xatoni tutadi.                                ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

import type { LedgerEntryType, Prisma } from '@prisma/client';
import {
  PLATFORM_ESCROW,
  PLATFORM_ESCROW_LIABILITY,
  PLATFORM_REVENUE,
  PROVIDER_FEE_EXPENSE,
  userAvailable,
  userHolding,
  userPending,
} from '@escrowuz/shared';
import { prisma } from '../db/prisma.js';
import { ApiError } from '../lib/errors.js';

export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerError';
  }
}

/** Bitta pul harakatining bitta "oyog'i". */
export interface LedgerLeg {
  readonly accountId: string;
  /** Musbat = hisobga kirdi, manfiy = hisobdan chiqdi. Tiyinda. */
  readonly amount: bigint;
  readonly entryType: LedgerEntryType;
  readonly description?: string;
}

export interface PostParams {
  readonly legs: readonly LedgerLeg[];
  /**
   * Takror yozishni bloklaydi.
   *
   * Bir xil kalit bilan ikkinchi urinish HECH NARSA qilmaydi va xato ham
   * bermaydi — shunchaki mavjud tranzaksiyani qaytaradi. "Confirm" tugmasi
   * ikki marta bosilganda pul ikki marta o'tmasligi shunga bog'liq.
   */
  readonly idempotencyKey: string;
  readonly dealId?: string | undefined;
  readonly currency?: string;
}

export interface PostResult {
  readonly transactionId: string;
  /** `true` bo'lsa — bu takroriy chaqiruv edi, yangi yozuv qo'shilmadi. */
  readonly wasReplay: boolean;
}

/**
 * Ledgerga muvozanatli tranzaksiya yozadi.
 *
 * `tx` berilsa mavjud tranzaksiya ichida ishlaydi — bu MAJBURIY holat:
 * pul yozuvi va savdo holati bitta tranzaksiyada bo'lishi kerak, aks holda
 * biri yozilib ikkinchisi yozilmay qolishi mumkin.
 */
export async function post(
  params: PostParams,
  tx: Prisma.TransactionClient = prisma,
): Promise<PostResult> {
  const { legs, idempotencyKey, dealId, currency = 'UZS' } = params;

  // ── 1-qavat: ilova darajasidagi tekshiruvlar ──────────────────────────────
  if (legs.length < 2) {
    throw new LedgerError(
      `Ledger tranzaksiyasida kamida 2 ta yozuv bo'lishi kerak, berilgan: ${legs.length}`,
    );
  }

  const total = legs.reduce((sum, leg) => sum + leg.amount, 0n);
  if (total !== 0n) {
    throw new LedgerError(
      `Ledger tranzaksiyasi muvozanatsiz: yig'indi = ${total} (0 bo'lishi shart).\n` +
        legs.map((l) => `  ${l.amount >= 0n ? '+' : ''}${l.amount}  ${l.accountId}`).join('\n'),
    );
  }

  for (const leg of legs) {
    if (leg.amount === 0n) {
      throw new LedgerError(`Nol summali yozuv ma'nosiz: ${leg.accountId}`);
    }
    if (!leg.accountId || leg.accountId.trim() === '') {
      throw new LedgerError('Hisob ID bo\'sh bo\'lishi mumkin emas');
    }
  }

  // ── Idempotentlik ─────────────────────────────────────────────────────────
  //
  // Har bir oyoq o'z unique kalitini oladi (`<key>:<index>`), chunki
  // `idempotency_key` ustuni ustida unique indeks bor. Birinchi oyoqning
  // kaliti butun tranzaksiyaning "borligini" bildiradi.
  const firstKey = `${idempotencyKey}:0`;

  const existing = await tx.ledgerEntry.findUnique({
    where: { idempotencyKey: firstKey },
    select: { transactionId: true },
  });

  if (existing) {
    // Takroriy chaqiruv — hech narsa yozmaymiz.
    return { transactionId: existing.transactionId, wasReplay: true };
  }

  const transactionId = crypto.randomUUID();

  try {
    await tx.ledgerEntry.createMany({
      data: legs.map((leg, index) => ({
        accountId: leg.accountId,
        dealId: dealId ?? null,
        amount: leg.amount,
        currency,
        entryType: leg.entryType,
        transactionId,
        idempotencyKey: `${idempotencyKey}:${index}`,
        description: leg.description ?? null,
      })),
    });
  } catch (err) {
    // Unique cheklov buzilishi = poyga holati: boshqa so'rov bizdan oldin
    // ulgurdi. Bu XATO EMAS — natija bir xil, pul bir marta o'tdi.
    if (isUniqueViolation(err)) {
      const raced = await tx.ledgerEntry.findUnique({
        where: { idempotencyKey: firstKey },
        select: { transactionId: true },
      });
      if (raced) return { transactionId: raced.transactionId, wasReplay: true };
    }
    throw err;
  }

  return { transactionId, wasReplay: false };
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'P2002'
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAYYOR PUL HARAKATLARI
//
// Har biri §4 dagi hisob sxemasiga qat'iy amal qiladi. Yangi harakat
// qo'shilganda ham yig'indi 0 bo'lishi shart — `post()` buni tekshiradi.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * To'lov keldi → escrowga tushdi.
 *
 * DIQQAT: xaridor kartasidan yechilgan summa bilan bizning balansimizga
 * tushgan summa BIR XIL EMAS. To'lov tizimi o'z ulushini ushlab qoladi.
 *
 *   -C  external:<provayder>          xaridor kartasidan yechilgan
 *   +F  expense:payment_provider      to'lov tizimi ushlab qolgani
 *   +E  platform:escrow               bizning balansimizga tushgani
 *   +E  user:<sotuvchi>:pending       sotuvchining shartli da'vosi
 *   -E  platform:escrow_liability     majburiyat
 *
 *   C = E + F  →  yig'indi 0 ✓
 *
 * `expense:payment_provider` hisobi bo'lmasa escrowda bo'lmagan pul
 * bordek ko'rinardi va savdo yakunlanganda to'lashga mablag' yetmasdi.
 */
export function depositLegs(
  sellerId: string,
  escrowTiyin: bigint,
  providerFeeTiyin: bigint,
  provider: string,
): LedgerLeg[] {
  const charged = escrowTiyin + providerFeeTiyin;

  const legs: LedgerLeg[] = [
    { accountId: `external:${provider}`, amount: -charged, entryType: 'deposit' },
    { accountId: PLATFORM_ESCROW, amount: escrowTiyin, entryType: 'deposit' },
    { accountId: userPending(sellerId), amount: escrowTiyin, entryType: 'deposit' },
    { accountId: PLATFORM_ESCROW_LIABILITY, amount: -escrowTiyin, entryType: 'deposit' },
  ];

  if (providerFeeTiyin > 0n) {
    legs.push({
      accountId: PROVIDER_FEE_EXPENSE,
      amount: providerFeeTiyin,
      entryType: 'commission',
      description: `${provider} to'lov komissiyasi`,
    });
  }

  return legs;
}

/**
 * Savdo yakunlandi → pul sotuvchiga, komissiya platformaga.
 *
 * ⚠️ Pul `available` ga EMAS, `holding` ga tushadi.
 *
 * Sabab: savdo yakunlangach ham pul 30 soat ushlab turiladi
 * (`WALLET_HOLD_HOURS`). Muddat tugagach fon vazifasi `releaseHoldLegs`
 * bilan uni `available` ga ko'chiradi va shundan keyingina yechib olinadi.
 *
 * Nega kerak: to'lov tizimi to'lovni qaytarib olishi mumkin, va firibgar
 * soxta savdo qilib pulni darhol yechib ketolmasligi kerak.
 *
 * `sellerTiyin` + `commissionTiyin` = `escrowTiyin` bo'lishi shart.
 */
export function releaseLegs(
  sellerId: string,
  escrowTiyin: bigint,
  sellerTiyin: bigint,
  commissionTiyin: bigint,
): LedgerLeg[] {
  if (sellerTiyin + commissionTiyin !== escrowTiyin) {
    throw new LedgerError(
      `Taqsimot escrow summasiga teng emas: ${sellerTiyin} + ${commissionTiyin} !== ${escrowTiyin}`,
    );
  }

  const legs: LedgerLeg[] = [
    // Escrowdan chiqarish
    { accountId: PLATFORM_ESCROW, amount: -escrowTiyin, entryType: 'release' },
    { accountId: PLATFORM_ESCROW_LIABILITY, amount: escrowTiyin, entryType: 'release' },
    // Sotuvchining muzlatilgan da'vosini yopish
    { accountId: userPending(sellerId), amount: -escrowTiyin, entryType: 'release' },
  ];

  if (sellerTiyin > 0n) {
    legs.push({ accountId: userHolding(sellerId), amount: sellerTiyin, entryType: 'release' });
  }
  if (commissionTiyin > 0n) {
    // Komissiya darhol platformaga — u chargeback xavfiga tushmaydi,
    // chunki qaytarish bo'lsa komissiya ham qaytariladi (siyosat bo'yicha).
    legs.push({ accountId: PLATFORM_REVENUE, amount: commissionTiyin, entryType: 'commission' });
  }

  return legs;
}

/**
 * 30 soatlik muddat tugadi → pul `holding` dan `available` ga.
 *
 * Bu ODDIY ko'chirish: umumiy pul miqdori o'zgarmaydi, faqat qaysi
 * hisobda turgani o'zgaradi. Shuning uchun ikki oyoq yetarli va
 * yig'indi 0 bo'ladi.
 *
 * Fon vazifasi (`release-holds`) chaqiradi.
 */
export function releaseHoldLegs(userId: string, amountTiyin: bigint): LedgerLeg[] {
  if (amountTiyin <= 0n) {
    throw new LedgerError(`Muzlatilgan summa musbat bo'lishi kerak, kelgan: ${amountTiyin}`);
  }

  return [
    { accountId: userHolding(userId), amount: -amountTiyin, entryType: 'release' },
    {
      accountId: userAvailable(userId),
      amount: amountTiyin,
      entryType: 'release',
      description: 'Ushlab turish muddati tugadi',
    },
  ];
}

/**
 * Pul xaridorga qaytadi (to'liq yoki qisman).
 *
 * Qaytgan pul xaridorning `available` balansiga tushadi — u yerdan
 * yechib olishi yoki boshqa savdoda ishlatishi mumkin.
 */
export function refundLegs(
  buyerId: string,
  sellerId: string,
  escrowTiyin: bigint,
  toBuyerTiyin: bigint,
  toSellerTiyin: bigint,
  commissionTiyin: bigint,
): LedgerLeg[] {
  const distributed = toBuyerTiyin + toSellerTiyin + commissionTiyin;
  if (distributed !== escrowTiyin) {
    throw new LedgerError(
      `Taqsimot escrow summasiga teng emas: ` +
        `${toBuyerTiyin} + ${toSellerTiyin} + ${commissionTiyin} = ${distributed} !== ${escrowTiyin}`,
    );
  }

  const legs: LedgerLeg[] = [
    { accountId: PLATFORM_ESCROW, amount: -escrowTiyin, entryType: 'refund' },
    { accountId: PLATFORM_ESCROW_LIABILITY, amount: escrowTiyin, entryType: 'refund' },
    { accountId: userPending(sellerId), amount: -escrowTiyin, entryType: 'refund' },
  ];

  if (toBuyerTiyin > 0n) {
    legs.push({ accountId: userAvailable(buyerId), amount: toBuyerTiyin, entryType: 'refund' });
  }
  if (toSellerTiyin > 0n) {
    legs.push({ accountId: userAvailable(sellerId), amount: toSellerTiyin, entryType: 'release' });
  }
  if (commissionTiyin > 0n) {
    legs.push({ accountId: PLATFORM_REVENUE, amount: commissionTiyin, entryType: 'commission' });
  }

  return legs;
}

/**
 * Foydalanuvchi pulni tashqariga yechib oldi.
 *
 * ⚠️ O'ZI YETARLI MABLAG'NI TEKSHIRMAYDI.
 *
 * Bu funksiya shunchaki yozuvlarni quradi. Balans yetarliligini
 * `assertSufficientFunds()` tekshiradi va u SHU TRANZAKSIYA ICHIDA,
 * `post()` dan OLDIN chaqirilishi SHART — u foydalanuvchi qatorini
 * `FOR UPDATE` bilan qulflaydi, ya'ni ikkita parallel yechish so'rovi
 * ikkalasi ham "yetarli" javobini ololmaydi.
 *
 * Namuna: `wallet/wallet.routes.ts` — yagona to'g'ri chaqiruv joyi.
 *
 * Tekshiruvsiz chaqirilsa balans MANFIY bo'lib qoladi va ledger buni
 * to'xtatmaydi: yozuvlar muvozanatda (SUM = 0), shunchaki mavjud
 * bo'lmagan pul yechilgan bo'ladi. Aynan shunday xato `ledger.test.ts`
 * da bo'lgan — 30 soatlik muzlatish qo'shilganda test yangilanmay
 * qolib, bo'sh `available` hisobidan yechgan.
 */
export function payoutLegs(userId: string, amountTiyin: bigint, provider: string): LedgerLeg[] {
  return [
    { accountId: userAvailable(userId), amount: -amountTiyin, entryType: 'payout' },
    { accountId: `external:${provider}:payout`, amount: amountTiyin, entryType: 'payout' },
  ];
}

/** Yechish muvaffaqiyatsiz tugadi — pul qaytariladi. */
export function payoutReversalLegs(
  userId: string,
  amountTiyin: bigint,
  provider: string,
): LedgerLeg[] {
  return [
    { accountId: `external:${provider}:payout`, amount: -amountTiyin, entryType: 'payout_reversal' },
    { accountId: userAvailable(userId), amount: amountTiyin, entryType: 'payout_reversal' },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// BALANSLAR
// ─────────────────────────────────────────────────────────────────────────────

export interface WalletBalance {
  /** Yechib olish mumkin bo'lgan summa. */
  readonly availableTiyin: bigint;
  /** Savdo hali yakunlanmagan — natija noma'lum. */
  readonly pendingTiyin: bigint;
  /**
   * Savdo yakunlangan, pul sotuvchiniki — lekin 30 soatlik ushlab turish
   * muddati tugamagan. Muddat tugagach `available` ga o'tadi.
   */
  readonly holdingTiyin: bigint;
}

/**
 * Foydalanuvchi balansi — DOIM ledgerdan hisoblanadi.
 *
 * `users` jadvalida `balance` ustuni yo'q va bo'lmasligi ham kerak:
 * keshlangan balans ledgerdan ajralib ketishi mumkin, va o'sha paytda
 * qaysi biri haqiqat ekani noma'lum bo'lib qoladi.
 */
export async function getBalance(
  userId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<WalletBalance> {
  const rows = await tx.ledgerEntry.groupBy({
    by: ['accountId'],
    where: {
      accountId: {
        in: [userAvailable(userId), userPending(userId), userHolding(userId)],
      },
    },
    _sum: { amount: true },
  });

  const find = (account: string): bigint =>
    rows.find((r) => r.accountId === account)?._sum.amount ?? 0n;

  return {
    availableTiyin: find(userAvailable(userId)),
    pendingTiyin: find(userPending(userId)),
    holdingTiyin: find(userHolding(userId)),
  };
}

/**
 * Yechib olish uchun yetarli mablag' bormi — QULFLANGAN holda tekshiradi.
 *
 * Oddiy `getBalance()` yetarli emas: ikkita parallel yechish so'rovi
 * ikkalasi ham "yetarli" degan javob olib, jami balansdan ko'p pul
 * chiqarib yuborishi mumkin.
 */
export async function assertSufficientFunds(
  userId: string,
  amountTiyin: bigint,
  tx: Prisma.TransactionClient,
): Promise<bigint> {
  // Foydalanuvchi qatorini qulflaymiz — shu foydalanuvchining boshqa pul
  // amallari biz tugatgunimizcha kutadi.
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;

  const { availableTiyin } = await getBalance(userId, tx);

  if (amountTiyin <= 0n) {
    throw ApiError.badRequest('Summa musbat bo\'lishi kerak');
  }
  if (availableTiyin < amountTiyin) {
    throw new ApiError(
      400,
      'INSUFFICIENT_FUNDS',
      `Mablag' yetarli emas. Mavjud: ${availableTiyin} tiyin, so'ralgan: ${amountTiyin} tiyin`,
    );
  }
  return availableTiyin;
}

/** Savdoning ledgerdagi umumiy holati — tekshiruv va tarix uchun. */
export async function getDealLedger(dealId: string): Promise<
  Array<{ accountId: string; amount: bigint; entryType: string; createdAt: Date }>
> {
  return prisma.ledgerEntry.findMany({
    where: { dealId },
    select: { accountId: true, amount: true, entryType: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
}
