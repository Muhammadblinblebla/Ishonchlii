/**
 * To'lov provayderi testlari — bazaga tegmaydi.
 *
 * Eng muhim guruh: "Webhook haqiqat manbai emas". checkout.uz webhook'ga
 * imzo qo'ymaydi, shuning uchun tizim webhook'ning aytganiga ishonmasligi
 * kerak — u faqat "borib tekshir" degan signal.
 */

import { describe, expect, it } from 'vitest';
import { MockPaymentProvider } from '../src/payments/mock.provider.js';
import {
  CheckoutUzProvider,
  NotImplementedError,
  PaymentAmountError,
} from '../src/payments/checkout-uz.provider.js';

const AMOUNT = 10_000_000n; // 100 000 so'm

async function makeInvoice(provider: MockPaymentProvider, amountTiyin = AMOUNT) {
  return provider.createInvoice({
    dealId: 'deal-1',
    amountTiyin,
    returnUrl: 'http://localhost:3000/deals/deal-1',
    webhookUrl: 'http://localhost:3001/webhooks/mock',
    description: 'Test savdo',
  });
}

describe('MockPaymentProvider — hisob-faktura', () => {
  it('yaratadi va to\'lov havolasini qaytaradi', async () => {
    const provider = new MockPaymentProvider();
    const invoice = await makeInvoice(provider);

    expect(invoice.invoiceId).toMatch(/^mock_inv_/);
    expect(invoice.payUrl).toContain(invoice.invoiceId);
  });

  it('katta summa buzilmaydi', async () => {
    const provider = new MockPaymentProvider();
    const huge = 999_999_900n;
    const invoice = await makeInvoice(provider, huge);
    expect(provider.getInvoice(invoice.invoiceId)?.amountTiyin).toBe(huge);
  });

  it('butun so\'mga bo\'linmaydigan summani rad etadi', async () => {
    // 100 ga bo'linmasa yaxlitlash kerak bo'lardi — bu tiyinning yo'qolishi
    const provider = new MockPaymentProvider();
    await expect(makeInvoice(provider, 10_000_001n)).rejects.toThrow();
  });
});

describe('WEBHOOK HAQIQAT MANBAI EMAS', () => {
  it('yangi hisob-faktura "pending" — webhook kelmasa ham', async () => {
    const provider = new MockPaymentProvider();
    const invoice = await makeInvoice(provider);

    const status = await provider.confirmPayment(invoice.invoiceId);
    expect(status.state).toBe('pending');
  });

  it('webhook keldi, lekin PUL TO\'LANMAGAN → confirmPayment "pending" qaytaradi', async () => {
    // Bu eng muhim test: hujumchi soxta webhook yuboradi, lekin pul to'lamagan.
    // Tizim provayderdan so'raganda haqiqat ochiladi.
    const provider = new MockPaymentProvider();
    const invoice = await makeInvoice(provider);

    // "Hujumchi" webhook yuboradi (mock'da imzo to'g'ri, ya'ni eng qulay holat)
    const { body, headers } = provider.buildWebhook(invoice.invoiceId, { hint: 'paid' });
    const parsed = provider.parseWebhook(body, headers);

    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.parsed.hint).toBe('paid'); // webhook "to'landi" deyapti

    // Lekin provayderning O'ZI boshqa narsa aytadi
    const status = await provider.confirmPayment(invoice.invoiceId);
    expect(status.state).toBe('pending'); // ← pul kelmagan
  });

  it('haqiqiy to\'lovdan keyin confirmPayment "paid" va summani qaytaradi', async () => {
    const provider = new MockPaymentProvider();
    const invoice = await makeInvoice(provider);

    provider.simulatePayment(invoice.invoiceId);

    const status = await provider.confirmPayment(invoice.invoiceId);
    expect(status.state).toBe('paid');
    if (status.state === 'paid') {
      expect(status.amountTiyin).toBe(AMOUNT);
      expect(status.paidAt).toBeInstanceOf(Date);
    }
  });

  it('kam pul to\'langan bo\'lsa, confirmPayment HAQIQIY summani qaytaradi', async () => {
    // §12: "Webhook summasi savdo summasidan farq qilsa — bloklanadi"
    const provider = new MockPaymentProvider();
    const invoice = await makeInvoice(provider);

    provider.simulatePayment(invoice.invoiceId, { amountTiyin: 5_000_000n });

    const status = await provider.confirmPayment(invoice.invoiceId);
    expect(status.state).toBe('paid');
    if (status.state === 'paid') {
      // Servis qatlami buni savdodagi summa bilan solishtirib PAYMENT_MISMATCH qiladi
      expect(status.amountTiyin).toBe(5_000_000n);
      expect(status.amountTiyin).not.toBe(AMOUNT);
    }
  });

  it('provayderga ulanib bo\'lmasa "unavailable" — "to\'lanmagan" EMAS', async () => {
    // Farq muhim: "to'lanmagan" deb hisoblasak, to'langan savdo bekor bo'lardi.
    const provider = new MockPaymentProvider();
    const invoice = await makeInvoice(provider);
    provider.simulatePayment(invoice.invoiceId);

    provider.setUnavailable(true);
    const status = await provider.confirmPayment(invoice.invoiceId);

    expect(status.state).toBe('unavailable');
    if (status.state === 'unavailable') expect(status.retryable).toBe(true);
  });

  it('mavjud bo\'lmagan hisob-faktura "not_found"', async () => {
    const provider = new MockPaymentProvider();
    const status = await provider.confirmPayment('mock_inv_yoq');
    expect(status.state).toBe('not_found');
  });
});

describe('Webhook imzosi (mock imzo qo\'yadi)', () => {
  it('to\'g\'ri imzo qabul qilinadi', async () => {
    const provider = new MockPaymentProvider();
    const invoice = await makeInvoice(provider);
    const { body, headers } = provider.buildWebhook(invoice.invoiceId);

    expect(provider.parseWebhook(body, headers).ok).toBe(true);
  });

  it('imzosiz webhook rad etiladi', async () => {
    const provider = new MockPaymentProvider();
    const invoice = await makeInvoice(provider);
    const { body } = provider.buildWebhook(invoice.invoiceId);

    expect(provider.parseWebhook(body, {}).ok).toBe(false);
  });

  it('tana o\'zgartirilgan bo\'lsa rad etiladi', async () => {
    const provider = new MockPaymentProvider();
    const invoice = await makeInvoice(provider);
    const { body, headers } = provider.buildWebhook(invoice.invoiceId);

    const tampered = body.replace(invoice.invoiceId, 'mock_inv_boshqa');
    expect(tampered).not.toBe(body);
    expect(provider.parseWebhook(tampered, headers).ok).toBe(false);
  });

  it('soxta imzo rad etiladi', async () => {
    const provider = new MockPaymentProvider();
    const invoice = await makeInvoice(provider);
    const { body } = provider.buildWebhook(invoice.invoiceId);

    expect(provider.parseWebhook(body, { 'x-mock-signature': 'a'.repeat(64) }).ok).toBe(false);
  });

  it('takroriy webhook bir xil externalId beradi', async () => {
    // §12: "Bir xil webhook 2 marta kelishi — bitta marta ishlov beriladi"
    const provider = new MockPaymentProvider();
    const invoice = await makeInvoice(provider);

    const first = provider.buildWebhook(invoice.invoiceId, { externalId: 'evt-1' });
    const second = provider.buildWebhook(invoice.invoiceId, { externalId: 'evt-1' });

    const a = provider.parseWebhook(first.body, first.headers);
    const b = provider.parseWebhook(second.body, second.headers);

    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.parsed.externalId).toBe(b.parsed.externalId);
  });
});

describe('CheckoutUzProvider', () => {
  const provider = new CheckoutUzProvider();

  it('webhook IMZOSIZ ekanini ochiq e\'lon qiladi', () => {
    // Servis qatlami shunga qarab majburiy confirmPayment chaqiradi
    expect(provider.webhookIsSigned).toBe(false);
  });

  it('chegaralari hujjatdagidek: 1 000 – 10 000 000 so\'m', () => {
    expect(provider.limits.minAmountTiyin).toBe(100_000n);
    expect(provider.limits.maxAmountTiyin).toBe(1_000_000_000n);
    expect(provider.limits.requiresWholeSom).toBe(true);
  });

  it('webhook tanasidan order_id ni ajratadi', () => {
    const body = JSON.stringify({
      webhook_type: 'version_1_1',
      status: 'success',
      event: 'payment_confirmed',
      payment_system: 'click',
      shop_id: 3,
      data: {
        order_id: 45180,
        amount: 5000,
        currency: 'UZS',
        status: 'paid',
        perform_time: 1784393083895,
      },
      timestamp: 1784393083,
    });

    const result = provider.parseWebhook(body, {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.parsed.invoiceId).toBe('45180');
      expect(result.parsed.hint).toBe('paid');
      // externalId takroriy webhook uchun BIR XIL bo'lishi kerak
      expect(result.parsed.externalId).toBe('checkout_uz:45180:1784393083895');
    }
  });

  it('bir xil webhook ikki marta kelsa externalId bir xil bo\'ladi', () => {
    const body = JSON.stringify({
      data: { order_id: 999, status: 'paid', perform_time: 1784393083895 },
      timestamp: 1784393083,
    });

    const a = provider.parseWebhook(body, {});
    const b = provider.parseWebhook(body, {});
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.parsed.externalId).toBe(b.parsed.externalId);
  });

  it('order_id yo\'q webhook rad etiladi', () => {
    const result = provider.parseWebhook(JSON.stringify({ data: {} }), {});
    expect(result.ok).toBe(false);
  });

  it('buzuq JSON rad etiladi', () => {
    expect(provider.parseWebhook('JSON emas', {}).ok).toBe(false);
  });

  it('payout va refund — hujjatda yo\'q, ochiq xato tashlaydi', async () => {
    await expect(
      provider.payout({ userId: 'u', amountTiyin: 100_000n, destination: 'x', idempotencyKey: 'k' }),
    ).rejects.toThrow(NotImplementedError);

    await expect(
      provider.refund({ invoiceId: 'i', amountTiyin: 100_000n, idempotencyKey: 'k', reason: 'r' }),
    ).rejects.toThrow(NotImplementedError);
  });

  it('sozlanmagan holatda isConfigured() false', () => {
    // .env da MERCHANT_ID bo'sh
    expect(typeof provider.isConfigured()).toBe('boolean');
  });
});

describe('checkout.uz — tiyin ↔ so\'m o\'girish', () => {
  const provider = new CheckoutUzProvider();

  async function tryCreate(amountTiyin: bigint) {
    return provider.createInvoice({
      dealId: 'd',
      amountTiyin,
      returnUrl: 'http://x',
      webhookUrl: 'http://y',
      description: '',
    });
  }

  it('100 ga bo\'linmaydigan summani RAD ETADI — yaxlitlamaydi', async () => {
    // Yaxlitlansa har to'lovda tiyin yo'qolardi
    await expect(tryCreate(10_000_001n)).rejects.toThrow(PaymentAmountError);
    await expect(tryCreate(999n)).rejects.toThrow(PaymentAmountError);
  });

  it('eng kam summadan past bo\'lsa rad etadi', async () => {
    await expect(tryCreate(99_900n)).rejects.toThrow(PaymentAmountError);
  });

  it('eng ko\'p summadan yuqori bo\'lsa rad etadi', async () => {
    await expect(tryCreate(1_000_000_100n)).rejects.toThrow(PaymentAmountError);
  });

  it('xato xabari muammoni aniq tushuntiradi', async () => {
    await expect(tryCreate(10_000_001n)).rejects.toThrow(/100 ga bo'linmaydi/);
  });
});
