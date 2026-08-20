/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  PUL MATEMATIKASI                                                        ║
 * ║                                                                          ║
 * ║  Barcha summalar `bigint`, TIYINDA. `number` ishlatilmaydi:              ║
 * ║  JavaScript'ning `number` turi 2^53 dan katta butun sonni aniq saqlay    ║
 * ║  olmaydi, `float` esa 0.1+0.2 !== 0.3 muammosini keltiradi.              ║
 * ║                                                                          ║
 * ║  HAR BIR funksiya yig'indisi AYNAN teng chiqadigan taqsimot qaytaradi.   ║
 * ║  Yaxlitlashda bo'linmay qolgan tiyin yo'qolmaydi — u siyosatda           ║
 * ║  belgilangan tomonga beriladi.                                          ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

import {
  COMMISSION_POLICY,
  type CommissionPayer,
  type RemainderBeneficiary,
} from './commission-policy.js';

const BPS_DENOMINATOR = 10_000n;

/** Summa noto'g'ri bo'lganda tashlanadi. Chaqiruvchi buni 400 xatoga aylantiradi. */
export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

// ─── Asosiy yordamchilar ─────────────────────────────────────────────────────

/**
 * `amount * bps / 10000`, pastga yaxlitlash bilan.
 *
 * Manfiy summa uchun ham to'g'ri ishlashi kerak edi, lekin bu yerda
 * summalar doim musbat — manfiy kelsa bu xato, shuning uchun rad etiladi.
 */
export function applyBps(amount: bigint, bps: number): bigint {
  if (amount < 0n) throw new MoneyError('Manfiy summaga foiz qo\'llab bo\'lmaydi');
  if (!Number.isInteger(bps) || bps < 0) {
    throw new MoneyError(`Bazis punkt butun va manfiy bo'lmasligi kerak: ${bps}`);
  }
  return (amount * BigInt(bps)) / BPS_DENOMINATOR;
}

/**
 * Summani ikkiga bo'ladi: `first` pastga yaxlitlanadi, qoldiq `second` ga ketadi.
 * Qaytgan ikkita son yig'indisi HAR DOIM `total` ga teng.
 */
function splitWithRemainder(
  total: bigint,
  firstShareBps: number,
): { first: bigint; second: bigint } {
  const first = applyBps(total, firstShareBps);
  return { first, second: total - first };
}

// ─── Komissiya ───────────────────────────────────────────────────────────────

/**
 * Tovar narxidan komissiyani hisoblaydi.
 *
 * Siyosatdagi min/max chegaralar qo'llanadi, lekin komissiya HECH QACHON
 * summaning o'zidan katta bo'lmaydi — aks holda sotuvchi manfiy pul olardi.
 */
export function computeCommission(
  amountTiyin: bigint,
  rateBps: number = COMMISSION_POLICY.rateBps,
): bigint {
  if (amountTiyin <= 0n) {
    throw new MoneyError('Savdo summasi musbat bo\'lishi kerak');
  }

  let commission = applyBps(amountTiyin, rateBps);

  const min = BigInt(COMMISSION_POLICY.minCommissionTiyin);
  if (commission < min) commission = min;

  if (COMMISSION_POLICY.maxCommissionTiyin !== null) {
    const max = BigInt(COMMISSION_POLICY.maxCommissionTiyin);
    if (commission > max) commission = max;
  }

  // Xavfsizlik chegarasi: komissiya summani yeb qo'ymasligi kerak
  if (commission > amountTiyin) commission = amountTiyin;

  return commission;
}

// ─── To'lov taqsimoti ────────────────────────────────────────────────────────

export interface PaymentBreakdown {
  /** Kelishilgan tovar narxi. */
  readonly amountTiyin: bigint;
  /** Xaridor kartasidan yechiladigan summa (to'lov komissiyasi bilan). */
  readonly buyerPaysTiyin: bigint;
  /**
   * To'lov tizimi ushlab qoladigan summa.
   *
   * Bu bizga TUSHMAYDI — provayder o'zi oladi. Ledgerda alohida yoziladi,
   * aks holda escrowda bo'lmagan pul bordek ko'rinardi.
   */
  readonly providerFeeTiyin: bigint;
  /**
   * Bizning balansimizga tushadigan summa = buyerPays − providerFee.
   * Sotuvchi va platforma ulushi SHU summadan chiqadi.
   */
  readonly escrowTiyin: bigint;
  /** Sotuvchi qo'liga tegadigan summa. */
  readonly sellerReceivesTiyin: bigint;
  /** Platforma daromadi. */
  readonly commissionTiyin: bigint;
  readonly commissionPayer: CommissionPayer;
  readonly commissionBps: number;
}

/**
 * `commission_payer` ga qarab kim qancha to'lashini hisoblaydi.
 *
 * `amountTiyin` — KELISHILGAN TOVAR NARXI (xaridor to'laydigan summa emas).
 *
 *   payer='seller' → xaridor narxni to'laydi, sotuvchi narx−komissiya oladi
 *   payer='buyer'  → xaridor narx+komissiya to'laydi, sotuvchi to'liq narxni oladi
 *   payer='split'  → komissiya ikkiga bo'linadi
 *
 * Invariant (har uch holatda ham):
 *   buyerPays === sellerReceives + commission
 */
export function computePaymentBreakdown(
  amountTiyin: bigint,
  commissionPayer: CommissionPayer = COMMISSION_POLICY.defaultPayer,
  rateBps: number = COMMISSION_POLICY.rateBps,
  providerFeeBps: number = COMMISSION_POLICY.providerFeeBps,
): PaymentBreakdown {
  assertValidDealAmount(amountTiyin);

  const commission = computeCommission(amountTiyin, rateBps);

  // ── 1. Escrowga qancha tushishi kerak ─────────────────────────────────────
  //
  // Bu sotuvchi va platforma ulushining yig'indisi. `commission_payer`
  // faqat shu ikkisi orasidagi taqsimotni belgilaydi.
  let escrowNeeded: bigint;
  let sellerReceives: bigint;

  switch (commissionPayer) {
    case 'seller':
      escrowNeeded = amountTiyin;
      sellerReceives = amountTiyin - commission;
      break;

    case 'buyer':
      escrowNeeded = amountTiyin + commission;
      sellerReceives = amountTiyin;
      break;

    case 'split': {
      // Xaridor ulushi pastga yaxlitlanadi → qoldiq tiyin xaridor foydasiga.
      const { first: buyerShare, second: sellerShare } = splitWithRemainder(
        commission,
        COMMISSION_POLICY.splitPayerBuyerShareBps,
      );
      escrowNeeded = amountTiyin + buyerShare;
      sellerReceives = amountTiyin - sellerShare;
      break;
    }
  }

  // ── 2. Xaridordan qancha yechiladi ────────────────────────────────────────
  //
  // To'lov tizimi o'z ulushini USHLAB QOLADI, ya'ni kartadan yechilgan
  // summadan kamrog'i bizga tushadi. Shuning uchun teskari hisoblaymiz:
  // provayder ulushi ayirilgandan keyin `escrowNeeded` qolishi kerak.
  //
  //     buyerPays × (1 − fee) = escrowNeeded
  //     buyerPays = escrowNeeded / (1 − fee)
  //
  // Yuqoriga yaxlitlanadi: kam bo'lgandan ko'ra bir tiyin ortiq bo'lgani
  // xavfsizroq — kam bo'lsa sotuvchiga to'lashga pul yetmaydi.
  const denominator = BigInt(10_000 - providerFeeBps);
  if (denominator <= 0n) {
    throw new MoneyError(`To'lov tizimi komissiyasi 100% dan kam bo'lishi kerak: ${providerFeeBps}`);
  }

  // To'lov tizimi butun so'm qabul qiladi, shuning uchun yuqoriga —
  // keyingi to'liq so'mgacha yaxlitlanadi. Ortiqcha qism escrowga emas,
  // provayder ulushiga qo'shiladi: shunda escrowda AYNAN kerakli summa
  // turadi va taqsimot hisob-kitobi o'zgarmaydi.
  const raw = ceilDiv(escrowNeeded * 10_000n, denominator);
  const buyerPays = ceilDiv(raw, 100n) * 100n;

  const providerFee = buyerPays - escrowNeeded;

  const breakdown: PaymentBreakdown = {
    amountTiyin,
    buyerPaysTiyin: buyerPays,
    providerFeeTiyin: providerFee,
    escrowTiyin: escrowNeeded,
    sellerReceivesTiyin: sellerReceives,
    commissionTiyin: commission,
    commissionPayer,
    commissionBps: rateBps,
  };

  assertBreakdownBalanced(breakdown);
  return breakdown;
}

/** Yuqoriga yaxlitlab bo'lish. Butun son arifmetikasi — float ishlatilmaydi. */
function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

/**
 * Taqsimot muvozanatda ekanini tekshiradi.
 *
 * Bu "shunchaki ehtiyot chorasi" emas: yuqoridagi `switch` ga yangi variant
 * qo'shilganda arifmetika buzilsa, xato SHU YERDA to'xtaydi — ledgerga
 * yetib bormaydi.
 */
function assertBreakdownBalanced(b: PaymentBreakdown): void {
  // Escrowdagi pul aynan sotuvchi + platforma ulushiga teng bo'lishi kerak
  const distributed = b.sellerReceivesTiyin + b.commissionTiyin;
  if (b.escrowTiyin !== distributed) {
    throw new MoneyError(
      `Escrow taqsimotga teng emas: ${b.escrowTiyin} !== ` +
        `sotuvchi (${b.sellerReceivesTiyin}) + komissiya (${b.commissionTiyin}) = ${distributed}`,
    );
  }
  // Xaridor to'lovi escrow + provayder ulushiga teng bo'lishi kerak
  if (b.buyerPaysTiyin !== b.escrowTiyin + b.providerFeeTiyin) {
    throw new MoneyError(
      `Xaridor to'lovi mos kelmadi: ${b.buyerPaysTiyin} !== ` +
        `escrow (${b.escrowTiyin}) + to'lov komissiyasi (${b.providerFeeTiyin})`,
    );
  }
  if (b.sellerReceivesTiyin < 0n) {
    throw new MoneyError('Sotuvchi manfiy summa olishi mumkin emas');
  }
  if (b.providerFeeTiyin < 0n) {
    throw new MoneyError('To\'lov komissiyasi manfiy bo\'la olmaydi');
  }
}

// ─── Nizo natijasidagi taqsimot ──────────────────────────────────────────────

export interface DisputeDistribution {
  readonly toBuyerTiyin: bigint;
  readonly toSellerTiyin: bigint;
  readonly toPlatformTiyin: bigint;
}

/**
 * Escrowdagi pulni admin qaroriga ko'ra taqsimlaydi.
 *
 * `escrowTiyin` — escrowda turgan summa (xaridor tushirgani).
 * `buyerShareBps` — xaridor oladigan ulush (6000 = 60%).
 * `takeCommission` — komissiya olinsinmi (siyosatdan keladi).
 *
 * Tartib: AVVAL komissiya olinadi, QOLGANI foizda bo'linadi.
 * Bo'linmay qolgan tiyin siyosatdagi tomonga (standart: xaridorga) ketadi.
 *
 * Invariant: toBuyer + toSeller + toPlatform === escrowTiyin
 */
export function distributeSplit(
  escrowTiyin: bigint,
  buyerShareBps: number,
  commissionTiyin: bigint,
  takeCommission: boolean,
): DisputeDistribution {
  if (escrowTiyin < 0n) throw new MoneyError('Escrow summasi manfiy bo\'la olmaydi');
  if (!Number.isInteger(buyerShareBps) || buyerShareBps < 0 || buyerShareBps > 10_000) {
    throw new MoneyError(`Xaridor ulushi 0..10000 bps oralig'ida bo'lishi kerak: ${buyerShareBps}`);
  }
  if (commissionTiyin < 0n) throw new MoneyError('Komissiya manfiy bo\'la olmaydi');
  if (commissionTiyin > escrowTiyin) {
    throw new MoneyError('Komissiya escrowdagi summadan katta bo\'la olmaydi');
  }

  const platform = takeCommission ? commissionTiyin : 0n;
  const distributable = escrowTiyin - platform;

  // Qoldiq tiyin kimga ketishi siyosatga bog'liq.
  const distribution = allocateRemainder(distributable, buyerShareBps, COMMISSION_POLICY.remainderTo);

  const result: DisputeDistribution = {
    toBuyerTiyin: distribution.buyer,
    toSellerTiyin: distribution.seller,
    toPlatformTiyin: platform,
  };

  assertDistributionExact(result, escrowTiyin);
  return result;
}

/**
 * Summani xaridor/sotuvchi orasida bo'ladi, qoldiqni belgilangan tomonga beradi.
 *
 * `remainderTo: 'platform'` bu yerda ma'nosiz (platforma ulushi allaqachon
 * ajratilgan), shuning uchun u xaridorga tenglashtiriladi — shubhali holatda
 * pul xaridor foydasiga hal qilinadi.
 */
function allocateRemainder(
  total: bigint,
  buyerShareBps: number,
  remainderTo: RemainderBeneficiary,
): { buyer: bigint; seller: bigint } {
  if (remainderTo === 'seller') {
    // Sotuvchi ulushi pastga yaxlitlanadi → qoldiq... xaridorga qolardi.
    // Shuning uchun teskarisini hisoblaymiz: xaridorni pastga yaxlitlab,
    // qoldiqni sotuvchiga beramiz.
    const buyer = applyBps(total, buyerShareBps);
    return { buyer, seller: total - buyer };
  }
  // 'buyer' yoki 'platform': sotuvchini pastga yaxlitlaymiz, qoldiq xaridorga.
  const seller = applyBps(total, 10_000 - buyerShareBps);
  return { buyer: total - seller, seller };
}

function assertDistributionExact(d: DisputeDistribution, expected: bigint): void {
  const sum = d.toBuyerTiyin + d.toSellerTiyin + d.toPlatformTiyin;
  if (sum !== expected) {
    throw new MoneyError(
      `Taqsimot yig'indisi mos kelmadi: ${sum} !== ${expected} (farq: ${sum - expected})`,
    );
  }
  if (d.toBuyerTiyin < 0n || d.toSellerTiyin < 0n || d.toPlatformTiyin < 0n) {
    throw new MoneyError('Taqsimotda manfiy summa bor');
  }
}

/** To'liq qaytarish — komissiyasiz. */
export function distributeFullRefund(escrowTiyin: bigint): DisputeDistribution {
  return { toBuyerTiyin: escrowTiyin, toSellerTiyin: 0n, toPlatformTiyin: 0n };
}

/** Komissiyani ushlab qolib qaytarish. */
export function distributeRefundKeepingCommission(
  escrowTiyin: bigint,
  commissionTiyin: bigint,
): DisputeDistribution {
  if (commissionTiyin > escrowTiyin) {
    throw new MoneyError('Komissiya escrowdagi summadan katta bo\'la olmaydi');
  }
  return {
    toBuyerTiyin: escrowTiyin - commissionTiyin,
    toSellerTiyin: 0n,
    toPlatformTiyin: commissionTiyin,
  };
}

// ─── Tekshiruvlar ────────────────────────────────────────────────────────────

export function assertValidDealAmount(amountTiyin: bigint): void {
  if (amountTiyin <= 0n) {
    throw new MoneyError('Savdo summasi musbat bo\'lishi kerak');
  }
  const min = BigInt(COMMISSION_POLICY.minDealAmountTiyin);
  const max = BigInt(COMMISSION_POLICY.maxDealAmountTiyin);

  if (amountTiyin < min) {
    throw new MoneyError(
      `Savdo summasi kamida ${formatTiyin(min)} bo'lishi kerak`,
    );
  }
  if (amountTiyin > max) {
    throw new MoneyError(
      `Savdo summasi ${formatTiyin(max)} dan oshmasligi kerak`,
    );
  }
}

// ─── Formatlash ──────────────────────────────────────────────────────────────

/**
 * Tiyinni o'zbekcha ko'rinishga o'giradi: `10000000` → `100 000 so'm`
 *
 * Ajratuvchi sifatida oddiy probel emas, UZUNMAS PROBEL (U+00A0) ishlatiladi —
 * shunda summa qator oxirida ikkiga bo'linib ketmaydi.
 */
export function formatTiyin(tiyin: bigint, options: { withCurrency?: boolean } = {}): string {
  const { withCurrency = true } = options;

  const negative = tiyin < 0n;
  const abs = negative ? -tiyin : tiyin;

  const soum = abs / 100n;
  const remainder = abs % 100n;

  let text = soum.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

  // Tiyin qoldig'i bo'lsa ko'rsatamiz — pul "yo'qolgandek" ko'rinmasligi uchun
  if (remainder !== 0n) {
    text += `,${remainder.toString().padStart(2, '0')}`;
  }

  if (negative) text = `−${text}`;
  return withCurrency ? `${text} so'm` : text;
}

/** `"100000"` yoki `100000` → `100000n`. Noto'g'ri qiymatda xato tashlaydi. */
export function parseTiyin(value: string | number | bigint): bigint {
  if (typeof value === 'bigint') return value;

  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      throw new MoneyError(`Summa butun son bo'lishi kerak (tiyinda): ${value}`);
    }
    if (!Number.isSafeInteger(value)) {
      throw new MoneyError('Summa juda katta — satr sifatida yuboring');
    }
    return BigInt(value);
  }

  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new MoneyError(`Summa faqat raqamlardan iborat bo'lishi kerak (tiyinda): "${value}"`);
  }
  return BigInt(trimmed);
}
