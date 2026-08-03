/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  checkout.uz                                                             ║
 * ║                                                                          ║
 * ║  Hujjat: https://checkout.uz/api-docs                                    ║
 * ║  Base URL: https://checkout.uz/api/v1                                    ║
 * ║  Auth: Authorization: Bearer <API_KEY>                                   ║
 * ║                                                                          ║
 * ║  ⚠️  UCHTA MUHIM CHEKLOV — kodda shularga moslashildi:                   ║
 * ║                                                                          ║
 * ║  1. SUMMA SO'MDA, tiyinda emas. Bizda hamma joyda tiyin, shuning        ║
 * ║     uchun 100 ga bo'linadi. Bo'linmasa — RAD ETILADI, yaxlitlanmaydi.   ║
 * ║                                                                          ║
 * ║  2. WEBHOOK IMZOSIZ. Provayder imzo qo'ymaydi, ya'ni webhook'ni          ║
 * ║     istalgan odam yubora oladi. Shuning uchun webhook hech narsani       ║
 * ║     tasdiqlamaydi — u faqat `confirmPayment()` ni chaqirish uchun signal.║
 * ║                                                                          ║
 * ║  3. WEBHOOK QAYTA YUBORILMAYDI. Hujjatdan: "unsuccessful attempts are    ║
 * ║     not auto-resent". Serverimiz o'sha lahzada ishlamasa, to'lov haqida  ║
 * ║     xabar BUTUNLAY yo'qoladi. Shuning uchun fon vazifasi kutilayotgan    ║
 * ║     to'lovlarni davriy ravishda o'zi so'rab turadi (7-bosqich).          ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

import { env } from '../config/env.js';
import type {
  CreateInvoiceParams,
  Invoice,
  ParsedWebhook,
  PaymentProvider,
  PaymentStatus,
  PayoutParams,
  PayoutResult,
  ProviderLimits,
  RefundParams,
  RefundResult,
  WebhookParse,
} from './provider.js';

export class NotImplementedError extends Error {
  constructor(what: string) {
    super(
      `checkout.uz: "${what}" hali qo'llab-quvvatlanmaydi. ` +
        `Provayder hujjatida bunday imkoniyat topilmadi.`,
    );
    this.name = 'NotImplementedError';
  }
}

export class PaymentAmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentAmountError';
  }
}

/** Hujjatdagi chegara: 1 000 – 10 000 000 so'm. */
const MIN_SOM = 1_000n;
const MAX_SOM = 10_000_000n;

interface CreatePaymentResponse {
  status?: string;
  payment?: {
    _id?: number;
    _uuid?: string;
    _url?: string;
    _amount?: number;
    _status?: string;
  };
  message?: string;
}

interface StatusPaymentResponse {
  status?: string;
  payment?: {
    _id?: number;
    _uuid?: string;
    _amount?: number;
    _status?: string;
    _perform_time?: number;
  };
  message?: string;
}

interface WebhookBody {
  webhook_type?: string;
  status?: string;
  event?: string;
  payment_system?: string;
  shop_id?: number;
  data?: {
    order_id?: number;
    amount?: number;
    currency?: string;
    status?: string;
    perform_time?: number;
  };
  timestamp?: number;
}

export class CheckoutUzProvider implements PaymentProvider {
  readonly name = 'checkout_uz';

  /** checkout.uz webhook'ga imzo qo'ymaydi — hujjatda imzo bo'limi yo'q. */
  readonly webhookIsSigned = false;

  readonly limits: ProviderLimits = {
    minAmountTiyin: MIN_SOM * 100n, //     100 000 tiyin =      1 000 so'm
    maxAmountTiyin: MAX_SOM * 100n, // 1 000 000 000 tiyin = 10 000 000 so'm
    requiresWholeSom: true,
  };

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs = 15_000;

  constructor() {
    this.baseUrl = env.CHECKOUT_UZ_BASE_URL.replace(/\/+$/, '');
    this.apiKey = env.CHECKOUT_UZ_API_KEY;
  }

  isConfigured(): boolean {
    return this.baseUrl !== '' && this.apiKey.trim() !== '';
  }

  // ── Tiyin ↔ so'm ───────────────────────────────────────────────────────────

  /**
   * Tiyinni so'mga o'giradi.
   *
   * Bo'linmasa YAXLITLAMAYDI, xato tashlaydi. Yaxlitlash — pulning
   * jimgina yo'qolishi degani, va u har bir to'lovda takrorlanadi.
   */
  private toSom(amountTiyin: bigint): bigint {
    if (amountTiyin % 100n !== 0n) {
      throw new PaymentAmountError(
        `checkout.uz faqat butun so'm qabul qiladi, lekin summa ${amountTiyin} tiyin — ` +
          `100 ga bo'linmaydi. Yaxlitlash pul yo'qolishiga olib keladi, shuning uchun rad etildi.`,
      );
    }
    const som = amountTiyin / 100n;

    if (som < MIN_SOM) {
      throw new PaymentAmountError(
        `checkout.uz eng kam ${MIN_SOM} so'm qabul qiladi, so'ralgan: ${som} so'm`,
      );
    }
    if (som > MAX_SOM) {
      throw new PaymentAmountError(
        `checkout.uz eng ko'p ${MAX_SOM} so'm qabul qiladi, so'ralgan: ${som} so'm`,
      );
    }
    return som;
  }

  /** So'mni tiyinga qaytaradi. Provayder javobidagi summani o'girish uchun. */
  private fromSom(som: number): bigint {
    if (!Number.isInteger(som)) {
      throw new PaymentAmountError(`checkout.uz kasr summa qaytardi: ${som}`);
    }
    return BigInt(som) * 100n;
  }

  // ── HTTP ───────────────────────────────────────────────────────────────────

  private async post<T>(path: string, body: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const text = await res.text();

      if (!res.ok) {
        // Xato matnida API kalit bo'lishi mumkin emas, lekin ehtiyot uchun
        // javobning faqat boshini olamiz.
        throw new Error(`checkout.uz ${path} → HTTP ${res.status}: ${text.slice(0, 300)}`);
      }

      try {
        return JSON.parse(text) as T;
      } catch {
        throw new Error(`checkout.uz ${path} → JSON emas: ${text.slice(0, 300)}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  // ── Interfeys metodlari ────────────────────────────────────────────────────

  async createInvoice(params: CreateInvoiceParams): Promise<Invoice> {
    const som = this.toSom(params.amountTiyin);

    const response = await this.post<CreatePaymentResponse>('/create_payment', {
      amount: Number(som),
      description: params.description.slice(0, 255),
      webhook_url: params.webhookUrl,
      return_url: params.returnUrl,
    });

    const payment = response.payment;
    if (response.status !== 'success' || !payment?._id || !payment._url) {
      throw new Error(
        `checkout.uz hisob-faktura yaratmadi: ${response.message ?? JSON.stringify(response).slice(0, 300)}`,
      );
    }

    // Provayder qaytargan summa so'ralganiga mos kelishini TEKSHIRAMIZ.
    // Mos kelmasa — bu bizning tomondagi xato yoki provayder o'zgarishi;
    // ikkalasida ham to'xtash to'g'ri, chunki xaridor boshqa summani to'laydi.
    if (payment._amount !== undefined && this.fromSom(payment._amount) !== params.amountTiyin) {
      throw new PaymentAmountError(
        `checkout.uz boshqa summa bilan hisob-faktura yaratdi: ` +
          `so'ralgan ${params.amountTiyin} tiyin, qaytgan ${this.fromSom(payment._amount)} tiyin`,
      );
    }

    return {
      // Webhook `data.order_id` bilan keladi va u `_id` ga teng — shuning
      // uchun aynan `_id` ni saqlaymiz, `_uuid` ni emas.
      invoiceId: String(payment._id),
      payUrl: payment._url,
    };
  }

  async confirmPayment(invoiceId: string): Promise<PaymentStatus> {
    let response: StatusPaymentResponse;

    try {
      response = await this.post<StatusPaymentResponse>('/status_payment', {
        id: Number(invoiceId),
      });
    } catch (err) {
      // Provayderga yetib bo'lmadi → holat NOMA'LUM.
      // "To'lanmagan" deb hisoblash ham, "to'langan" deb hisoblash ham xato.
      return {
        state: 'unavailable',
        error: err instanceof Error ? err.message : String(err),
        retryable: true,
      };
    }

    const payment = response.payment;
    if (!payment) return { state: 'not_found' };

    const status = payment._status;

    if (status === 'paid') {
      if (payment._amount === undefined) {
        return { state: 'unavailable', error: 'Javobda summa yo\'q', retryable: true };
      }
      return {
        state: 'paid',
        amountTiyin: this.fromSom(payment._amount),
        paidAt: payment._perform_time ? new Date(payment._perform_time) : null,
        providerRef: String(payment._id ?? invoiceId),
      };
    }

    if (status === 'pending') return { state: 'pending' };
    if (status === 'cancelled') return { state: 'cancelled', reason: 'Provayder bekor qildi' };
    if (status === 'failed') return { state: 'failed', reason: 'To\'lov amalga oshmadi' };

    // Noma'lum holat — taxmin qilmaymiz.
    return { state: 'unavailable', error: `Noma'lum holat: ${String(status)}`, retryable: true };
  }

  parseWebhook(rawBody: string, _headers: Record<string, string | undefined>): WebhookParse {
    // Imzo tekshiruvi YO'Q — provayder imzo qo'ymaydi. Shuning uchun bu metod
    // hech narsani tasdiqlamaydi, faqat "qaysi to'lovni tekshirish kerak"
    // degan savolga javob beradi.
    let body: WebhookBody;
    try {
      body = JSON.parse(rawBody) as WebhookBody;
    } catch {
      return { ok: false, reason: 'JSON o\'qib bo\'lmadi' };
    }

    const orderId = body.data?.order_id;
    if (orderId === undefined || orderId === null) {
      return { ok: false, reason: 'data.order_id yo\'q' };
    }

    const hint: ParsedWebhook['hint'] =
      body.data?.status === 'paid' || body.event === 'payment_confirmed'
        ? 'paid'
        : body.data?.status === 'cancelled'
          ? 'cancelled'
          : body.data?.status === 'failed'
            ? 'failed'
            : 'unknown';

    return {
      ok: true,
      parsed: {
        // Provayder alohida hodisa ID bermaydi. Takrorlanishni aniqlash uchun
        // to'lov ID + vaqt tamg'asidan tuzamiz. `perform_time` bir xil to'lov
        // uchun o'zgarmaydi, ya'ni takroriy webhook bir xil kalit beradi.
        externalId: `checkout_uz:${orderId}:${body.data?.perform_time ?? body.timestamp ?? 0}`,
        invoiceId: String(orderId),
        hint,
      },
    };
  }

  async payout(_params: PayoutParams): Promise<PayoutResult> {
    // Hujjatda payout (pul yechish) endpointi yo'q — faqat to'lov qabul qilish.
    // Sotuvchiga pul o'tkazish boshqa yo'l bilan hal qilinishi kerak
    // (bank o'tkazmasi yoki boshqa provayder).
    throw new NotImplementedError('payout — hujjatda bunday endpoint yo\'q');
  }

  async refund(_params: RefundParams): Promise<RefundResult> {
    // Hujjatda refund endpointi ham topilmadi.
    throw new NotImplementedError('refund — hujjatda bunday endpoint yo\'q');
  }
}
