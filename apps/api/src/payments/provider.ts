/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  TO'LOV PROVAYDERI INTERFEYSI                                            ║
 * ║                                                                          ║
 * ║  Tizimning qolgan qismi FAQAT shu interfeysni biladi.                    ║
 * ║                                                                          ║
 * ║  Qat'iy qoidalar:                                                        ║
 * ║   • Summalar `bigint`, TIYINDA. Provayder boshqa birlik ishlatsa,        ║
 * ║     o'girish AYNAN SHU implementatsiya ichida bo'ladi.                   ║
 * ║   • Hech bir metod bazaga yozmaydi.                                      ║
 * ║   • Webhook HECH QACHON haqiqat manbai emas — faqat "borib tekshir"      ║
 * ║     degan signal. Haqiqat `confirmPayment()` dan keladi.                 ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * NEGA WEBHOOK HAQIQAT MANBAI EMAS:
 *
 * Ba'zi provayderlar (jumladan checkout.uz) webhook'ga IMZO QO'YMAYDI.
 * Imzosiz webhook — bu shunchaki HTTP so'rov: manzilimizni bilgan istalgan
 * odam "to'lov keldi" deb yuborib, pulsiz savdoni FUNDED qilib qo'yishi
 * mumkin. Shuning uchun oqim doim shunday:
 *
 *     webhook keldi  →  faqat qayd etiladi (navbatga)
 *                    →  provayderning O'ZIDAN so'raymiz (confirmPayment)
 *                    →  javob "to'langan" bo'lsa VA summa mos kelsa
 *                    →  shundagina ledgerga yoziladi
 *
 * Bu §5 talabiga ham mos: "webhook hech qachon to'g'ridan-to'g'ri holatni
 * o'zgartirmaydi — u navbatga yozadi, keyin ishlov beriladi".
 */

/** Provayderning texnik chegaralari. Savdo yaratishda tekshiriladi. */
export interface ProviderLimits {
  /** Bitta to'lovdagi eng kam summa (tiyin). */
  readonly minAmountTiyin: bigint;
  /** Bitta to'lovdagi eng ko'p summa (tiyin). */
  readonly maxAmountTiyin: bigint;
  /**
   * Summa 100 ga bo'linishi shartmi.
   *
   * `true` bo'lsa provayder SO'M bilan ishlaydi va tiyin qismini qabul
   * qilmaydi. Bunday holda 100 ga bo'linmaydigan summa RAD ETILADI —
   * yaxlitlab yuborsak, tiyin jimgina yo'qoladi.
   */
  readonly requiresWholeSom: boolean;
}

export interface CreateInvoiceParams {
  readonly dealId: string;
  /** Xaridor to'lashi kerak bo'lgan summa (tiyin). */
  readonly amountTiyin: bigint;
  /** Xaridor to'lagach qaytadigan manzil. */
  readonly returnUrl: string;
  /** checkout.uz shu manzilga xabar yuboradi. */
  readonly webhookUrl: string;
  readonly description: string;
}

export interface Invoice {
  /** Provayder tomonidagi ID — webhook va status so'rovi shu bilan bog'lanadi. */
  readonly invoiceId: string;
  /** Xaridor yo'naltiriladigan to'lov sahifasi. */
  readonly payUrl: string;
  readonly expiresAt?: Date;
}

export interface PayoutParams {
  readonly userId: string;
  readonly amountTiyin: bigint;
  readonly destination: string;
  /** Takroriy yuborishni bloklaydi — pul ikki marta chiqmasligi uchun. */
  readonly idempotencyKey: string;
}

export interface RefundParams {
  readonly invoiceId: string;
  readonly amountTiyin: bigint;
  readonly idempotencyKey: string;
  readonly reason: string;
}

export type PayoutResult =
  | { readonly ok: true; readonly providerRef: string; readonly status: 'completed' | 'processing' }
  | { readonly ok: false; readonly error: string; readonly retryable: boolean };

export type RefundResult =
  | { readonly ok: true; readonly providerRef: string }
  | { readonly ok: false; readonly error: string; readonly retryable: boolean };

/**
 * Webhook'dan ajratib olingan MINIMAL ma'lumot.
 *
 * Bu yerda summa ATAYLAB yo'q: webhook'dagi summaga ishonilmaydi.
 * Haqiqiy summa `confirmPayment()` dan olinadi.
 */
export interface ParsedWebhook {
  /** Takrorlanishni aniqlash uchun — bir xil hodisa ikki marta ishlanmasin. */
  readonly externalId: string;
  /** Qaysi hisob-fakturaga tegishli. */
  readonly invoiceId: string;
  /** Provayder aytgan hodisa turi — faqat maslahat sifatida. */
  readonly hint: 'paid' | 'failed' | 'cancelled' | 'unknown';
}

export type WebhookParse =
  | { readonly ok: true; readonly parsed: ParsedWebhook }
  | { readonly ok: false; readonly reason: string };

/** `confirmPayment()` javobi — YAGONA ishonchli manba. */
export type PaymentStatus =
  | {
      readonly state: 'paid';
      /** Provayder tasdiqlagan summa (tiyin). Savdodagi summaga AYNAN teng bo'lishi shart. */
      readonly amountTiyin: bigint;
      readonly paidAt: Date | null;
      readonly providerRef: string;
    }
  | { readonly state: 'pending' }
  | { readonly state: 'failed' | 'cancelled'; readonly reason: string }
  | { readonly state: 'not_found' }
  /** Provayderga ulanib bo'lmadi — HOLAT NOMA'LUM. Hech narsa qilinmaydi, qayta urinamiz. */
  | { readonly state: 'unavailable'; readonly error: string; readonly retryable: true };

export interface PaymentProvider {
  readonly name: string;
  readonly limits: ProviderLimits;

  /**
   * Provayder pul CHIQARISHNI qo'llab-quvvatlaydimi.
   *
   * `false` bo'lsa (checkout.uz shunday) sotuvchiga pul o'tkazish qo'lda
   * bajariladi: yechish so'rovi admin panelida ko'rinadi, admin bank
   * orqali o'tkazadi va "bajarildi" deb belgilaydi.
   */
  readonly supportsPayout: boolean;

  /**
   * Provayderdagi merchant balansi (tiyin).
   *
   * Nega kerak: bizning ledgerimizda escrowda turgan pul provayder
   * balansidan KO'P bo'lib qolmasligi kerak. Bo'lib qolsa — savdo bekor
   * bo'lganda xaridorga qaytarishga pul yetmaydi.
   *
   * Qo'llab-quvvatlanmasa `null` qaytaradi.
   */
  getMerchantBalance(): Promise<bigint | null>;

  createInvoice(params: CreateInvoiceParams): Promise<Invoice>;

  /**
   * To'lov holatini PROVAYDERNING O'ZIDAN so'raydi.
   *
   * Pul harakati faqat shu metod `state: 'paid'` qaytargandan keyin
   * yoziladi. Webhook'ning aytgani hisobga olinmaydi.
   */
  confirmPayment(invoiceId: string): Promise<PaymentStatus>;

  payout(params: PayoutParams): Promise<PayoutResult>;

  refund(params: RefundParams): Promise<RefundResult>;

  /**
   * Webhook tanasidan identifikatorlarni ajratadi.
   *
   * Imzo bo'lsa — shu yerda tekshiriladi. Bo'lmasa (checkout.uz) — bu metod
   * faqat "qaysi hisob-fakturani tekshirish kerak" degan savolga javob beradi,
   * hech narsani TASDIQLAMAYDI.
   */
  parseWebhook(rawBody: string, headers: Record<string, string | undefined>): WebhookParse;

  /**
   * Webhook imzo bilan himoyalanganmi.
   *
   * `false` bo'lsa, servis qatlami har bir webhook uchun majburiy
   * `confirmPayment()` chaqiradi va webhook manzilini oshkor qilmaslik
   * choralarini ko'radi.
   */
  readonly webhookIsSigned: boolean;
}
