/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  CLICK — SHOP API                                                        ║
 * ║                                                                          ║
 * ║  Click checkout.uz'dan TUBDAN farq qiladi. Farqlarni bilmasdan kod       ║
 * ║  o'zgartirish pul yo'qolishiga olib keladi:                             ║
 * ║                                                                          ║
 * ║  1. HISOB-FAKTURA API ORQALI YARATILMAYDI.                              ║
 * ║     Click'da "create invoice" so'rovi yo'q — shunchaki to'lov havolasi   ║
 * ║     quriladi. Hisob-faktura ID'sini BIZ o'zimiz o'ylab topamiz va uni    ║
 * ║     `merchant_trans_id` sifatida yuboramiz.                             ║
 * ║                                                                          ║
 * ║  2. CALLBACK IKKI BOSQICHLI: Prepare (action=0) va Complete (action=1).  ║
 * ║     Click ikkalasiga ham ANIQ FORMATDAGI javob kutadi. Noto'g'ri javob   ║
 * ║     — to'lov bekor qilinadi.                                            ║
 * ║                                                                          ║
 * ║  3. CALLBACK IMZOLANGAN (MD5 + secret_key).                             ║
 * ║     checkout.uz imzo qo'ymasdi, shuning uchun har webhook'dan keyin      ║
 * ║     provayderdan qayta so'rardik. Click'da imzo haqiqiy autentifikatsiya:║
 * ║     to'g'ri imzoli Complete — ishonchli manba.                          ║
 * ║                                                                          ║
 * ║  4. SUMMA SO'MDA, kasr bilan: "1000.00". Tiyinda emas.                  ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

import { createHash, randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import type {
  CreateInvoiceParams,
  Invoice,
  PaymentProvider,
  PaymentStatus,
  PayoutParams,
  PayoutResult,
  ProviderLimits,
  RefundParams,
  RefundResult,
  WebhookParse,
} from './provider.js';
import { PaymentAmountError } from './checkout-uz.provider.js';

/** Xaridor yo'naltiriladigan to'lov sahifasi. */
const PAY_URL = 'https://my.click.uz/services/pay';
/** Merchant API — to'lov holatini so'rash uchun. */
const MERCHANT_API = 'https://api.click.uz/v2/merchant';

/**
 * Chegaralar.
 *
 * Click bilan shartnomada boshqacha bo'lsa shu yerni to'g'rilang.
 * Pastroq chegara — xavfsizroq: savdo YARATISHDA rad etilgani to'lov
 * paytida rad etilganidan yaxshi.
 */
const MIN_SOM = 1_000n;
const MAX_SOM = 100_000_000n;

/** Click callback'idagi `action` maydoni. */
export const CLICK_ACTION = { PREPARE: 0, COMPLETE: 1 } as const;

/**
 * Click xato kodlari — javobda AYNAN shular qaytariladi.
 * Click ularni o'zi talqin qiladi, o'zimiznikini o'ylab topib bo'lmaydi.
 */
export const CLICK_ERROR = {
  SUCCESS: 0,
  SIGN_CHECK_FAILED: -1,
  INCORRECT_AMOUNT: -2,
  ACTION_NOT_FOUND: -3,
  ALREADY_PAID: -4,
  USER_NOT_FOUND: -5,
  TRANSACTION_NOT_FOUND: -6,
  FAILED_TO_UPDATE: -7,
  ERROR_IN_REQUEST: -8,
  TRANSACTION_CANCELLED: -9,
} as const;

/** Click yuboradigan callback maydonlari (Prepare va Complete uchun umumiy). */
export interface ClickCallback {
  readonly click_trans_id: string;
  readonly service_id: string;
  readonly click_paydoc_id?: string;
  readonly merchant_trans_id: string;
  readonly merchant_prepare_id?: string;
  readonly amount: string;
  readonly action: string;
  readonly error: string;
  readonly error_note?: string;
  readonly sign_time: string;
  readonly sign_string: string;
}

export class ClickProvider implements PaymentProvider {
  readonly name = 'click';

  /**
   * Click callback'ga IMZO QO'YADI (MD5 + secret_key).
   *
   * Shuning uchun `true`. Bu checkout.uz'dan asosiy farq: imzo to'g'ri
   * bo'lsa, xabar haqiqatan Click'dan kelgani isbotlangan.
   */
  readonly webhookIsSigned = true;

  /**
   * Click'da pul CHIQARISH (payout) alohida shartnoma va alohida API talab
   * qiladi. Hozircha yo'q — sotuvchiga pul o'tkazish admin panelida qo'lda
   * bajariladi va bu holat allaqachon qo'llab-quvvatlangan.
   */
  readonly supportsPayout = false;

  readonly limits: ProviderLimits = {
    minAmountTiyin: MIN_SOM * 100n,
    maxAmountTiyin: MAX_SOM * 100n,
    // Click so'm bilan ishlaydi — tiyin qismi qabul qilinmaydi
    requiresWholeSom: true,
  };

  private readonly serviceId: string;
  private readonly merchantId: string;
  private readonly secretKey: string;
  private readonly merchantUserId: string;
  private readonly timeoutMs = 15_000;

  /**
   * Sozlamalar odatda muhit o'zgaruvchilaridan olinadi.
   *
   * `config` faqat TESTLAR uchun: imzo tekshiruvi xavfsizlikning eng nozik
   * joyi va uni ma'lum kalit bilan sinab ko'rish shart. Ilova kodida bu
   * parametr HECH QAYERDA berilmaydi.
   */
  constructor(config?: {
    serviceId: string;
    merchantId: string;
    secretKey: string;
    merchantUserId: string;
  }) {
    this.serviceId = (config?.serviceId ?? env.CLICK_SERVICE_ID).trim();
    this.merchantId = (config?.merchantId ?? env.CLICK_MERCHANT_ID).trim();
    this.secretKey = (config?.secretKey ?? env.CLICK_SECRET_KEY).trim();
    this.merchantUserId = (config?.merchantUserId ?? env.CLICK_MERCHANT_USER_ID).trim();
  }

  isConfigured(): boolean {
    return (
      this.serviceId !== '' &&
      this.merchantId !== '' &&
      this.secretKey !== '' &&
      this.merchantUserId !== ''
    );
  }

  // ── Tiyin ↔ so'm ───────────────────────────────────────────────────────────

  /** Tiyinni so'mga. Bo'linmasa YAXLITLAMAYDI — xato tashlaydi. */
  private toSom(amountTiyin: bigint): bigint {
    if (amountTiyin % 100n !== 0n) {
      throw new PaymentAmountError(
        `Click faqat butun so'm qabul qiladi, lekin summa ${amountTiyin} tiyin — ` +
          `100 ga bo'linmaydi. Yaxlitlash pul yo'qolishiga olib keladi.`,
      );
    }
    const som = amountTiyin / 100n;
    if (som < MIN_SOM) {
      throw new PaymentAmountError(`Click eng kam ${MIN_SOM} so'm qabul qiladi, so'ralgan: ${som}`);
    }
    if (som > MAX_SOM) {
      throw new PaymentAmountError(`Click eng ko'p ${MAX_SOM} so'm qabul qiladi, so'ralgan: ${som}`);
    }
    return som;
  }

  /**
   * Click qaytargan summani tiyinga o'giradi.
   *
   * Click summani "1000.00" ko'rinishida yuboradi. `parseFloat`
   * ISHLATILMAYDI — suzuvchi nuqta katta summalarda tiyin yo'qotadi.
   */
  fromSom(value: string | number): bigint {
    const text = String(value).trim();
    const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(text);
    if (!match) {
      throw new PaymentAmountError(
        `Click tushunarsiz summa qaytardi: "${text}". Kutilgan: "1000" yoki "1000.00".`,
      );
    }
    const whole = BigInt(match[1]!);
    const fraction = (match[2] ?? '').padEnd(2, '0');
    return whole * 100n + BigInt(fraction);
  }

  // ── Imzo ───────────────────────────────────────────────────────────────────

  /**
   * Callback imzosini tekshiradi.
   *
   * Formula Click hujjatlarida qat'iy belgilangan — maydonlar tartibi
   * o'zgarsa imzo mos kelmaydi:
   *
   *   Prepare  : md5(click_trans_id + service_id + KEY + merchant_trans_id
   *                  + amount + action + sign_time)
   *   Complete : md5(click_trans_id + service_id + KEY + merchant_trans_id
   *                  + merchant_prepare_id + amount + action + sign_time)
   *
   * ⚠️ `amount` Click YUBORGAN satr ko'rinishida ishlatiladi. Uni qayta
   * formatlab ("1000.00" → "1000") imzo buziladi.
   */
  verifySignature(cb: ClickCallback): boolean {
    if (this.secretKey === '') return false;

    const isComplete = cb.action === String(CLICK_ACTION.COMPLETE);

    const parts = [
      cb.click_trans_id,
      cb.service_id,
      this.secretKey,
      cb.merchant_trans_id,
      ...(isComplete ? [cb.merchant_prepare_id ?? ''] : []),
      cb.amount,
      cb.action,
      cb.sign_time,
    ];

    const expected = createHash('md5').update(parts.join(''), 'utf8').digest('hex');

    // Uzunligi bir xil bo'lsa vaqt bo'yicha xavfsiz solishtiramiz.
    // MD5 hex doim 32 belgi, shuning uchun oddiy tenglik ham yetarli,
    // lekin odat sifatida to'g'ri usulni qo'llaymiz.
    const given = (cb.sign_string ?? '').toLowerCase();
    if (given.length !== expected.length) return false;

    let diff = 0;
    for (let i = 0; i < expected.length; i++) {
      diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
    }
    return diff === 0;
  }

  // ── Hisob-faktura ──────────────────────────────────────────────────────────

  /**
   * To'lov havolasini quradi.
   *
   * Tarmoqqa CHIQMAYDI: Click'da hisob-faktura yaratish so'rovi yo'q.
   * `invoiceId` — bizning o'zimiz yaratgan ID, u Click'ga
   * `merchant_trans_id` sifatida boradi va callback'da qaytib keladi.
   */
  async createInvoice(params: CreateInvoiceParams): Promise<Invoice> {
    if (!this.isConfigured()) {
      throw new Error('Click sozlanmagan: CLICK_* muhit o\'zgaruvchilarini to\'ldiring');
    }

    const som = this.toSom(params.amountTiyin);
    const invoiceId = randomUUID();

    const url = new URL(PAY_URL);
    url.searchParams.set('service_id', this.serviceId);
    url.searchParams.set('merchant_id', this.merchantId);
    url.searchParams.set('amount', som.toString());
    url.searchParams.set('transaction_param', invoiceId);
    url.searchParams.set('return_url', params.returnUrl);

    return { invoiceId, payUrl: url.toString() };
  }

  // ── Holat tekshiruvi ───────────────────────────────────────────────────────

  /**
   * To'lov holatini Click'dan so'raydi.
   *
   * Bu ZAXIRA yo'l: asosiy oqim imzolangan Complete callback orqali ketadi.
   * Bu metod callback yo'qolganda fon vazifasi (`reconcile-payments`)
   * ishlatadi.
   *
   * ⚠️ Noaniq holatda DOIM `unavailable` qaytaradi, `not_found` EMAS.
   * `not_found` savdoni bekor qilishga olib keladi — to'langan to'lovni
   * "yo'q" deb hisoblash eng qimmat xato.
   */
  async confirmPayment(invoiceId: string): Promise<PaymentStatus> {
    if (!this.isConfigured()) {
      return { state: 'unavailable', error: 'Click sozlanmagan', retryable: true };
    }

    // Click `status_by_mti` uchun to'lov SANASINI ham talab qiladi.
    // Callback qachon kelganini bilmaganimiz uchun bugungi va kechagi
    // kunni sinaymiz — to'lov yarim tunda bo'lgan bo'lishi mumkin.
    const today = new Date();
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

    let lastError = 'javob olinmadi';

    for (const date of [today, yesterday]) {
      const day = date.toISOString().slice(0, 10); // YYYY-MM-DD
      const path = `/payment/status_by_mti/${this.serviceId}/${invoiceId}/${day}`;

      try {
        const res = await this.get<{
          error_code?: number;
          error_note?: string;
          payment_status?: number;
          payment_id?: number | string;
          amount?: number | string;
        }>(path);

        // Click'da `payment_status`: 2 = muvaffaqiyatli to'langan.
        // Manfiy qiymatlar — bekor qilingan/qaytarilgan.
        if (res.payment_status === 2) {
          return {
            state: 'paid',
            amountTiyin: this.fromSom(res.amount ?? 0),
            paidAt: null,
            providerRef: String(res.payment_id ?? invoiceId),
          };
        }

        if (typeof res.payment_status === 'number' && res.payment_status < 0) {
          return { state: 'cancelled', reason: res.error_note ?? 'Click: to\'lov bekor qilingan' };
        }

        // Topilmadi yoki hali kutilmoqda — keyingi sanani sinaymiz.
        lastError = res.error_note ?? `payment_status=${String(res.payment_status)}`;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    // Ikkala sanada ham aniq javob yo'q.
    //
    // Bu YA to'lov umuman bo'lmagan, YA Click javob bermayapti degani —
    // ikkalasini ajratib bo'lmaydi. Shuning uchun `pending`: savdo
    // o'z holatida qoladi va hech qanday pul harakati bo'lmaydi.
    // `lastError` faqat log uchun.
    void lastError;
    return { state: 'pending' };
  }

  // ── Qo'llab-quvvatlanmaydigan amallar ──────────────────────────────────────

  /**
   * Click SHOP API pul chiqarishni qo'llab-quvvatlamaydi.
   *
   * Xato TASHLAMAYDI, `ok: false` qaytaradi — chaqiruvchi buni ko'rib
   * so'rovni admin navbatiga qo'yadi. Xato tashlansa foydalanuvchi
   * "xatolik yuz berdi" ko'rardi va puli qayerdaligini bilmasdi.
   */
  async payout(params: PayoutParams): Promise<PayoutResult> {
    return {
      ok: false,
      error:
        `Click SHOP API pul chiqarishni qo'llab-quvvatlamaydi. ` +
        `${params.amountTiyin} tiyin qo'lda o'tkaziladi.`,
      retryable: false,
    };
  }

  /**
   * Qaytarish (refund) Click'da alohida huquq talab qiladi.
   *
   * Hozircha qo'lda: pul xaridorning platformadagi hamyoniga qaytadi va
   * u yerdan yechib oladi. Ledger nuqtai nazaridan bu to'liq to'g'ri —
   * pul yo'qolmaydi, faqat chiqish yo'li boshqacha.
   */
  async refund(params: RefundParams): Promise<RefundResult> {
    return {
      ok: false,
      error: `Click orqali avtomatik qaytarish yo'q (${params.invoiceId}). Hamyon orqali qaytariladi.`,
      retryable: false,
    };
  }

  /** Click SHOP API merchant balansini bermaydi. */
  async getMerchantBalance(): Promise<bigint | null> {
    return null;
  }

  /**
   * Umumiy webhook interfeysi Click uchun ISHLATILMAYDI.
   *
   * Click'ning Prepare/Complete protokoli alohida marshrutlarda
   * (`webhooks/click.routes.ts`) — u yerda imzo tekshiriladi va Click
   * kutayotgan formatdagi javob qaytariladi.
   */
  parseWebhook(): WebhookParse {
    return {
      ok: false,
      reason: 'Click Prepare/Complete marshrutlari orqali ishlaydi, umumiy webhook orqali emas',
    };
  }

  // ── HTTP ───────────────────────────────────────────────────────────────────

  /**
   * Merchant API autentifikatsiyasi.
   *
   * `Auth: <merchant_user_id>:<sha1(timestamp + secret_key)>:<timestamp>`
   * Timestamp — UNIX soniyalarda.
   */
  private authHeader(): string {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const digest = createHash('sha1').update(timestamp + this.secretKey, 'utf8').digest('hex');
    return `${this.merchantUserId}:${digest}:${timestamp}`;
  }

  private async get<T>(path: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(`${MERCHANT_API}${path}`, {
        method: 'GET',
        headers: { Accept: 'application/json', Auth: this.authHeader() },
        signal: controller.signal,
      });

      const text = await res.text();
      if (!res.ok) {
        throw new Error(`Click ${res.status}: ${text.slice(0, 300)}`);
      }
      return JSON.parse(text) as T;
    } finally {
      clearTimeout(timer);
    }
  }
}
