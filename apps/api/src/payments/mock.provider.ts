/**
 * Test/MVP uchun to'lov provayderi.
 *
 * Haqiqiy pul harakati yo'q. Lekin oqim HAQIQIYSI BILAN BIR XIL:
 * webhook keladi → `confirmPayment()` chaqiriladi → shundagina pul yoziladi.
 * Aks holda testlar haqiqiy tizimni emas, soddalashtirilgan variantni
 * sinagan bo'lardi.
 *
 * Production'da ishlatib bo'lmaydi — `config/env.ts` bloklaydi.
 */

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
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

const MOCK_SECRET = 'mock-webhook-secret';

interface MockInvoice {
  dealId: string;
  amountTiyin: bigint;
  /** Provayder tomonidagi haqiqat — `confirmPayment` shundan o'qiydi. */
  state: 'pending' | 'paid' | 'cancelled' | 'failed';
  /** Haqiqatda to'langan summa. Testda ataylab boshqacha qilish mumkin. */
  paidAmountTiyin: bigint | null;
  paidAt: Date | null;
}

export interface MockWebhookPayload {
  event: string;
  externalId: string;
  invoiceId: string;
  hint: ParsedWebhook['hint'];
}

export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';

  /** Mock imzo qo'yadi — bu yo'l ham sinalishi kerak. */
  readonly webhookIsSigned = true;

  readonly limits: ProviderLimits = {
    minAmountTiyin: 100_000n, //         1 000 so'm
    maxAmountTiyin: 1_000_000_000n, // 10 000 000 so'm — checkout.uz bilan bir xil
    requiresWholeSom: true,
  };

  private readonly invoices = new Map<string, MockInvoice>();
  /** Provayder ishlamayotgan holatni sinash uchun. */
  private unavailable = false;

  createInvoice(params: CreateInvoiceParams): Promise<Invoice> {
    if (params.amountTiyin % 100n !== 0n) {
      return Promise.reject(
        new Error(`Mock provayder butun so'm kutadi, ${params.amountTiyin} tiyin 100 ga bo'linmaydi`),
      );
    }

    const invoiceId = `mock_inv_${randomUUID()}`;
    this.invoices.set(invoiceId, {
      dealId: params.dealId,
      amountTiyin: params.amountTiyin,
      state: 'pending',
      paidAmountTiyin: null,
      paidAt: null,
    });

    const webBase = env.corsOrigins[0] ?? 'http://localhost:3000';
    return Promise.resolve({
      invoiceId,
      payUrl: `${webBase}/mock-pay/${invoiceId}`,
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000), // §6: 48 soat
    });
  }

  confirmPayment(invoiceId: string): Promise<PaymentStatus> {
    if (this.unavailable) {
      return Promise.resolve({
        state: 'unavailable',
        error: 'Mock: provayder ataylab o\'chirilgan',
        retryable: true,
      });
    }

    const invoice = this.invoices.get(invoiceId);
    if (!invoice) return Promise.resolve({ state: 'not_found' });

    switch (invoice.state) {
      case 'paid':
        return Promise.resolve({
          state: 'paid',
          amountTiyin: invoice.paidAmountTiyin ?? invoice.amountTiyin,
          paidAt: invoice.paidAt,
          providerRef: `mock_ref_${invoiceId}`,
        });
      case 'pending':
        return Promise.resolve({ state: 'pending' });
      case 'cancelled':
        return Promise.resolve({ state: 'cancelled', reason: 'Mock: bekor qilindi' });
      case 'failed':
        return Promise.resolve({ state: 'failed', reason: 'Mock: to\'lov amalga oshmadi' });
    }
  }

  payout(params: PayoutParams): Promise<PayoutResult> {
    if (params.amountTiyin <= 0n) {
      return Promise.resolve({ ok: false, error: 'Summa musbat bo\'lishi kerak', retryable: false });
    }
    return Promise.resolve({
      ok: true,
      providerRef: `mock_payout_${randomUUID()}`,
      status: 'completed',
    });
  }

  refund(params: RefundParams): Promise<RefundResult> {
    if (params.amountTiyin <= 0n) {
      return Promise.resolve({ ok: false, error: 'Summa musbat bo\'lishi kerak', retryable: false });
    }
    return Promise.resolve({ ok: true, providerRef: `mock_refund_${randomUUID()}` });
  }

  parseWebhook(rawBody: string, headers: Record<string, string | undefined>): WebhookParse {
    const signature = headers['x-mock-signature'];
    if (!signature) return { ok: false, reason: 'Imzo (x-mock-signature) yo\'q' };

    const expected = MockPaymentProvider.sign(rawBody);

    // `===` emas: oddiy taqqoslash javob vaqti orqali imzoni topish
    // imkonini beradi. Uzunlik teng bo'lmasa timingSafeEqual xato tashlaydi.
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, reason: 'Imzo noto\'g\'ri' };
    }

    let payload: MockWebhookPayload;
    try {
      payload = JSON.parse(rawBody) as MockWebhookPayload;
    } catch {
      return { ok: false, reason: 'JSON o\'qib bo\'lmadi' };
    }

    if (!payload.externalId || !payload.invoiceId) {
      return { ok: false, reason: 'Majburiy maydonlar yetishmayapti' };
    }

    return {
      ok: true,
      parsed: {
        externalId: payload.externalId,
        invoiceId: payload.invoiceId,
        hint: payload.hint ?? 'unknown',
      },
    };
  }

  // ── Faqat testlar uchun ────────────────────────────────────────────────────

  static sign(rawBody: string): string {
    return createHmac('sha256', MOCK_SECRET).update(rawBody).digest('hex');
  }

  /**
   * "Xaridor to'ladi" — provayder tomonidagi holatni o'zgartiradi.
   *
   * `amountTiyin` ataylab boshqacha berilishi mumkin: §12 dagi
   * "webhook summasi savdo summasidan farq qilsa bloklanadi" testi shunga tayanadi.
   */
  simulatePayment(invoiceId: string, options: { amountTiyin?: bigint } = {}): void {
    const invoice = this.invoices.get(invoiceId);
    if (!invoice) throw new Error(`Mock: ${invoiceId} topilmadi`);
    invoice.state = 'paid';
    invoice.paidAmountTiyin = options.amountTiyin ?? invoice.amountTiyin;
    invoice.paidAt = new Date();
  }

  simulateFailure(invoiceId: string, state: 'cancelled' | 'failed' = 'failed'): void {
    const invoice = this.invoices.get(invoiceId);
    if (!invoice) throw new Error(`Mock: ${invoiceId} topilmadi`);
    invoice.state = state;
  }

  /** Provayderga ulanib bo'lmaydigan holatni sinash uchun. */
  setUnavailable(value: boolean): void {
    this.unavailable = value;
  }

  buildWebhook(
    invoiceId: string,
    options: { hint?: ParsedWebhook['hint']; externalId?: string } = {},
  ): { body: string; headers: Record<string, string> } {
    const payload: MockWebhookPayload = {
      event: 'payment_confirmed',
      externalId: options.externalId ?? `mock_evt_${randomUUID()}`,
      invoiceId,
      hint: options.hint ?? 'paid',
    };

    const body = JSON.stringify(payload);
    return {
      body,
      headers: {
        'content-type': 'application/json',
        'x-mock-signature': MockPaymentProvider.sign(body),
      },
    };
  }

  getInvoice(invoiceId: string): MockInvoice | undefined {
    return this.invoices.get(invoiceId);
  }

  reset(): void {
    this.invoices.clear();
    this.unavailable = false;
  }
}
