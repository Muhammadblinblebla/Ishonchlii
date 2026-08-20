/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  KOMISSIYA SIYOSATI — YAGONA MANBA                                       ║
 * ║                                                                          ║
 * ║  Komissiya bilan bog'liq HAR QANDAY qoida faqat shu faylda turadi.       ║
 * ║  Ledger, savdo API va admin panel faqat shu yerdan o'qiydi — biror       ║
 * ║  foizni yoki qoidani kod ichiga yozib qo'yish TAQIQLANADI.               ║
 * ║                                                                          ║
 * ║  Qoidani o'zgartirish = shu fayldagi bitta qiymatni almashtirish.        ║
 * ║  Boshqa hech qaysi faylga tegish kerak emas.                            ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

import type { DealStatus } from './deal-status.js';

/** Komissiya olinadigan yakuniy holatlarda pul qanday taqsimlanadi. */
export type RefundRule =
  /** Komissiya olinmaydi — xaridor tushirgan summani tiyingacha to'liq qaytaradi. */
  | 'return_all'
  /** Komissiya platformada qoladi, xaridorga faqat qolgani qaytadi. */
  | 'keep_commission'
  /** Komissiya to'liq olinadi, qolgani holat qoidasi bo'yicha taqsimlanadi. */
  | 'take_commission';

/** Yaxlitlashda bo'linmay qolgan tiyin kimga beriladi. */
export type RemainderBeneficiary = 'buyer' | 'seller' | 'platform';

/** Komissiyani kim ko'taradi. `deals.commission_payer` ustuni shu qiymatlarni oladi. */
export type CommissionPayer = 'buyer' | 'seller' | 'split';

export interface CommissionPolicy {
  /**
   * Komissiya stavkasi BAZIS PUNKTDA (1 bps = 0.01%).
   * Butun son — float ishlatilmaydi. 300 bps = 3%.
   */
  readonly rateBps: number;

  /**
   * To'lov tizimi komissiyasi (bazis punkt).
   *
   * Bu bizga tushmaydi — provayder ushlab qoladi. Xaridor to'lovi ustiga
   * qo'shiladi, shuning uchun escrowga kerakli summa to'liq tushadi.
   */
  readonly providerFeeBps: number;

  /** Savdo yaratilayotganda `commission_payer` ko'rsatilmasa shu ishlatiladi. */
  readonly defaultPayer: CommissionPayer;

  /**
   * Komissiyaning eng kam miqdori (tiyin). Juda kichik savdolarda foiz
   * 0 ga aylanib ketmasligi uchun. 0 = chegara yo'q.
   */
  readonly minCommissionTiyin: number;

  /** Komissiyaning eng ko'p miqdori (tiyin). null = chegara yo'q. */
  readonly maxCommissionTiyin: number | null;

  /**
   * Savdoning eng kam summasi (tiyin). Bundan pastda savdo yaratib bo'lmaydi.
   * 100 000 tiyin = 1 000 so'm.
   */
  readonly minDealAmountTiyin: number;

  /** Savdoning eng ko'p summasi (tiyin). 10 000 000 000 tiyin = 100 000 000 so'm. */
  readonly maxDealAmountTiyin: number;

  /**
   * `commission_payer = 'split'` bo'lganda komissiyaning necha foizini
   * XARIDOR ko'taradi (bazis punktda). 5000 bps = 50% (teng bo'linadi).
   * Bo'linmay qolgan tiyin `remainderTo` ga ketadi.
   */
  readonly splitPayerBuyerShareBps: number;

  /** Har qanday yaxlitlash qoldig'i kimga ketadi. */
  readonly remainderTo: RemainderBeneficiary;

  /**
   * Pul xaridorga (qisman yoki to'liq) qaytadigan yakuniy holatlarda
   * komissiya bilan nima qilinadi.
   */
  readonly refundRules: Readonly<Record<RefundableStatus, RefundRule>>;
}

/** Pul xaridorga qaytishi mumkin bo'lgan yakuniy holatlar. */
export type RefundableStatus = Extract<
  DealStatus,
  'REFUNDED' | 'RESOLVED_BUYER' | 'RESOLVED_SPLIT' | 'EXPIRED' | 'CANCELLED'
>;

export const COMMISSION_POLICY: CommissionPolicy = {
  rateBps: 100, // 1% — platformaning XIZMAT HAQQI
  defaultPayer: 'seller',

  /**
   * TO'LOV TIZIMI komissiyasi (bazis punkt). Click: 1% = 100 bps.
   *
   * ⚠️ Bu summa BIZGA TUSHMAYDI — provayder uni o'zi ushlab qoladi.
   * Shuning uchun u xaridor to'lovi USTIGA qo'shiladi: aks holda escrowga
   * kerakli summa to'liq tushmaydi va platforma farqni o'z hisobidan
   * qoplashga majbur bo'lardi.
   *
   * ⚠️ BU BIZNING TANLOVIMIZ EMAS — Click haqiqatda ushlab qoladigan foiz.
   * Haqiqiydan PAST qo'yilsa, platforma har savdoda zarar ko'radi.
   * Shartnomadagi aniq foizni tekshirib, shu yerga yozing.
   *
   * `rateBps` (1%) bilan birga xaridorga tushadigan umumiy ustama: 2%.
   */
  providerFeeBps: 100,

  minCommissionTiyin: 0,
  maxCommissionTiyin: null,

  // Chegaralar to'lov provayderining imkoniyatiga moslangan.
  // Click Pay bilan shartnoma tuzilgach, uning chegaralariga moslang.
  //
  // DIQQAT: `commission_payer='buyer'` bo'lganda xaridor `amount + komissiya`
  // to'laydi, ya'ni provayderga ketadigan summa bu chegaradan OSHIB ketishi
  // mumkin. Shuning uchun savdo yaratishda `amount` emas, XARIDOR TO'LAYDIGAN
  // summa provayder chegarasiga solishtiriladi.
  minDealAmountTiyin: 100_000, //         1 000 so'm
  maxDealAmountTiyin: 1_000_000_000, // 10 000 000 so'm

  splitPayerBuyerShareBps: 5_000, // 50/50
  remainderTo: 'buyer', // shubhali holatda xaridor foydasiga

  refundRules: {
    // Sotuvchi o'zi bekor qildi — xaridor aybdor emas, hammasi qaytadi.
    REFUNDED: 'return_all',

    // Nizo xaridor foydasiga hal bo'ldi.
    // 'keep_commission' ga o'zgartirsangiz platforma arbitraj haqini ushlab qoladi.
    RESOLVED_BUYER: 'return_all',

    // Nizo bo'lib hal qilindi: avval komissiya olinadi, qolgani foizda bo'linadi.
    RESOLVED_SPLIT: 'take_commission',

    // Pul umuman tushmagan — hisoblanadigan komissiya yo'q.
    EXPIRED: 'return_all',
    CANCELLED: 'return_all',
  },
} as const;

/**
 * Ushbu holat uchun qaytarish qoidasi.
 * Noma'lum holat kelsa — eng xavfsiz variant (`return_all`) qaytariladi,
 * ya'ni platforma o'ziga pul yozib olmaydi.
 */
export function refundRuleFor(status: RefundableStatus): RefundRule {
  return COMMISSION_POLICY.refundRules[status] ?? 'return_all';
}
