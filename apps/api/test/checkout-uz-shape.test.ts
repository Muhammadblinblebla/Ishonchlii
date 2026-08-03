/**
 * checkout.uz javob shakli — HAQIQIY so'rovdan olingan namunalar bilan.
 *
 * Bu namunalar 2026-08-03 da checkout.uz'ga yuborilgan haqiqiy so'rovdan
 * ko'chirilgan. Ular rasmiy hujjatdagi shakldan FARQ QILADI — hujjatga
 * ishonib yozilgan kod har bir to'lovni "topilmadi" deb hisoblardi.
 *
 * Provayder javobini o'zgartirsa shu testlar yiqiladi va biz buni
 * haqiqiy pul yo'qolishidan OLDIN bilamiz.
 */

import { describe, expect, it } from 'vitest';
import { CheckoutUzProvider } from '../src/payments/checkout-uz.provider.js';

const provider = new CheckoutUzProvider();

/** `provider['fromSom']` — private metodni sinash uchun. */
const fromSom = (v: string | number): bigint =>
  (provider as unknown as { fromSom: (v: string | number) => bigint }).fromSom(v);

describe('Summa o\'girish — haqiqiy javob formatlari', () => {
  it('/status_payment dagi "1000.00" satrini to\'g\'ri o\'giradi', () => {
    // Haqiqiy javob: { "amount": "1000.00" }
    expect(fromSom('1000.00')).toBe(100_000n);
  });

  it('/create_payment dagi 1000 sonini to\'g\'ri o\'giradi', () => {
    expect(fromSom(1000)).toBe(100_000n);
  });

  it('tiyin qismi YO\'QOLMAYDI', () => {
    expect(fromSom('1000.50')).toBe(100_050n);
    expect(fromSom('0.99')).toBe(99n);
    expect(fromSom('0.01')).toBe(1n);
  });

  it('bir xonali kasr o\'nlik ulush deb o\'qiladi', () => {
    // "1000.5" = 1000 so'm 50 tiyin, 5 tiyin EMAS
    expect(fromSom('1000.5')).toBe(100_050n);
  });

  it('katta summada ham aniqlik saqlanadi', () => {
    // float bilan hisoblansa bu yerda xato paydo bo'lardi
    expect(fromSom('9999999.99')).toBe(999_999_999n);
  });

  it('vergul bilan yozilgan kasrni ham qabul qiladi', () => {
    expect(fromSom('1000,00')).toBe(100_000n);
  });

  it('tushunarsiz formatni RAD ETADI', () => {
    expect(() => fromSom('abc')).toThrow();
    expect(() => fromSom('1000.000')).toThrow(); // 3 xonali kasr
    expect(() => fromSom('-100')).toThrow();
    expect(() => fromSom('')).toThrow();
  });
});

describe('Webhook shakli — hujjatdagi namuna', () => {
  it('data.order_id ni ajratadi', () => {
    const body = JSON.stringify({
      webhook_type: 'version_1_1',
      status: 'success',
      event: 'payment_confirmed',
      payment_system: 'click',
      data: { order_id: 50344, amount: 1000, status: 'paid', perform_time: 1784393083895 },
      timestamp: 1784393083,
    });

    const result = provider.parseWebhook(body, {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.parsed.invoiceId).toBe('50344');
      expect(result.parsed.hint).toBe('paid');
    }
  });
});

describe('checkout.uz chegaralari', () => {
  it('1 000 – 10 000 000 so\'m', () => {
    expect(provider.limits.minAmountTiyin).toBe(100_000n);
    expect(provider.limits.maxAmountTiyin).toBe(1_000_000_000n);
  });

  it('webhook imzosiz ekani e\'lon qilingan', () => {
    expect(provider.webhookIsSigned).toBe(false);
  });
});
