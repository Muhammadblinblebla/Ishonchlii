/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  NIZONI AVTOMATIK HAL QILISH — YAGONA MANBA                             ║
 * ║                                                                          ║
 * ║  Platformada ODAM (admin) hech narsani tekshirmaydi. Nizolarni tizim     ║
 * ║  o'zi hal qiladi — lekin FAQAT O'ZI BILADIGAN FAKTLAR asosida.          ║
 * ║                                                                          ║
 * ║  Tizim nimani ANIQ biladi:                                              ║
 * ║    • sotuvchi topshirish tugmasini bosganmi (savdo holati)              ║
 * ║    • topshirilgan narsa BAZADA bormi (mahsulot yozuvi, chat xabari,     ║
 * ║      trek-raqam)                                                        ║
 * ║    • xaridor uni ochib ko'rganmi (`viewedAt`, o'qilgan xabarlar)        ║
 * ║                                                                          ║
 * ║  Tizim nimani BILMAYDI:                                                 ║
 * ║    • fayl ichida va'da qilingan narsa bormi                             ║
 * ║    • akkaunt haqiqatan ishlaydimi                                       ║
 * ║    • tomonlardan qaysi biri rost gapiryapti                             ║
 * ║                                                                          ║
 * ║  ⚠️ SHUNING UCHUN: oxirgi qoida (D) — TAXMIN, hukm emas. U ba'zan       ║
 * ║  adolatsiz bo'ladi. Bu odam aralashuvini olib tashlashning muqarrar     ║
 * ║  narxi.                                                                 ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

/** Nizo qanday hal qilindi. */
export type AutoResolution = 'buyer' | 'seller' | 'split';

/** Tizim savdo haqida ANIQ biladigan faktlar. */
export interface DisputeFacts {
  /** Sotuvchi topshirish tugmasini bosganmi (savdo `SHIPPED` ga yetganmi). */
  readonly sellerMarkedDelivered: boolean;
  /**
   * Topshirilgan narsaning BAZADAGI IZI bormi.
   *
   * Raqamli mahsulot — yozuv bor; eFootball — sotuvchi chatga yozgan;
   * jismoniy tovar — trek-raqam kiritilgan.
   *
   * "Topshirdim" tugmasini bosib, hech narsa yubormaslik mumkin —
   * shuning uchun bu alohida tekshiriladi.
   */
  readonly deliveryEvidence: boolean;
  /** Xaridor topshirilgan narsani ochib ko'rganmi. */
  readonly buyerReceived: boolean;
}

export interface AutoDecision {
  readonly resolution: AutoResolution;
  /** `split` uchun xaridor ulushi (bazis punkt). */
  readonly buyerShareBps?: number;
  /** Ikkala tomonga ko'rsatiladigan sabab. */
  readonly reason: string;
  /**
   * Qaror ANIQ FAKTGA asoslanganmi.
   *
   * `false` = tizim haqiqatni bilmadi va taxminiy qoida ishlatdi.
   * Bu qiymat savdo tarixiga yoziladi — keyinchalik qancha nizo
   * taxmin bilan hal bo'lganini ko'rish uchun.
   */
  readonly certain: boolean;
}

export const DISPUTE_POLICY = {
  /**
   * Nizo ochilgandan keyin avtomatik hal qilishgacha o'tadigan vaqt (soat).
   *
   * Nega darhol emas: shu vaqt ichida tomonlar chatda kelishishi yoki
   * sotuvchi o'zi pulni qaytarishi mumkin. Ko'p nizo shu bosqichda
   * o'zi hal bo'ladi va tizim aralashmasligi kerak.
   */
  coolingHours: 24,

  /**
   * Ikkala tomonda ham dalil bo'lganda xaridor ulushi (bazis punkt).
   *
   * 5000 = 50/50. Nega teng: har qanday boshqa nisbat bir tomonni
   * yolg'on gapirishga rag'batlantiradi. Teng bo'lishda ikkalasi ham
   * yutqazadi, ya'ni yolg'ondan foyda kam.
   */
  contestedBuyerShareBps: 5_000,
} as const;

/**
 * Faktlar asosida qaror qabul qiladi.
 *
 * SOF funksiya: bazaga ham, vaqtga ham bog'liq emas. Shuning uchun
 * har bir qoidani test bilan qamrab olish oson.
 */
export function decideDispute(facts: DisputeFacts): AutoDecision {
  // ── A. Sotuvchi umuman topshirmagan ────────────────────────────────────
  //
  // Eng aniq holat: pul kelgan, sotuvchi hech narsa qilmagan.
  // Xaridor to'liq haqli.
  if (!facts.sellerMarkedDelivered) {
    return {
      resolution: 'buyer',
      reason:
        'Sotuvchi savdo bo\'yicha hech narsa topshirmadi. Pul to\'liq xaridorga qaytariladi.',
      certain: true,
    };
  }

  // ── B. "Topshirdim" bosilgan, lekin ortida hech narsa yo'q ─────────────
  //
  // Sotuvchi tugmani bosgan, lekin tizimda topshirilganlik izi yo'q:
  // mahsulot yuklanmagan, chatga yozilmagan, trek-raqam kiritilmagan.
  //
  // Bu ATAYLAB qilingan aldov bo'lishi mumkin — tugmani bosib, xaridor
  // e'tibor bermasa auto-release'ni kutish. Xaridor himoyalanadi.
  if (!facts.deliveryEvidence) {
    return {
      resolution: 'buyer',
      reason:
        'Sotuvchi "topshirdim" deb belgiladi, lekin tizimda topshirilganlik ' +
        'izi yo\'q. Pul to\'liq xaridorga qaytariladi.',
      certain: true,
    };
  }

  // ── C. Topshirilgan, lekin xaridor ochib ham ko'rmagan ─────────────────
  //
  // Xaridor mahsulotni umuman ochmasdan nizo ochgan. Sifat haqidagi
  // da'voni ko'rmasdan turib bildirib bo'lmaydi.
  if (!facts.buyerReceived) {
    return {
      resolution: 'seller',
      reason:
        'Sotuvchi mahsulotni topshirdi, lekin xaridor uni ochib ko\'rmadi. ' +
        'Pul sotuvchiga o\'tkaziladi.',
      certain: true,
    };
  }

  // ── D. Ikkala tomonda ham dalil bor — TIZIM HAQIQATNI BILMAYDI ─────────
  //
  // Sotuvchi topshirdi, xaridor oldi va ochdi, lekin sifatga e'tiroz
  // bildiryapti. Fayl ichida nima borligini yoki akkaunt ishlaganini
  // tizim tekshira olmaydi.
  //
  // ⚠️ Bu qaror TAXMIN. Odam arbitr bo'lganda boshqacha bo'lishi mumkin edi.
  return {
    resolution: 'split',
    buyerShareBps: DISPUTE_POLICY.contestedBuyerShareBps,
    reason:
      'Sotuvchi mahsulotni topshirdi, xaridor uni oldi, lekin sifat bo\'yicha ' +
      'kelisha olmadingiz. Tizim mahsulot ichini tekshira olmaydi, shuning ' +
      'uchun summa teng bo\'lindi.',
    certain: false,
  };
}
