/**
 * CLICK PROVAYDERI.
 *
 * Eng muhimi — IMZO TEKSHIRUVI. Agar u noto'g'ri ishlasa:
 *   • juda bo'shashgan bo'lsa — istalgan odam "pul keldi" deb yuborib,
 *     pulsiz savdolarni FUNDED qila oladi
 *   • juda qattiq bo'lsa — haqiqiy to'lovlar rad etiladi va pul Click'da
 *     osilib qoladi
 *
 * Bu testlar bazaga TEGMAYDI — sof hisob-kitob.
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CLICK_ACTION,
  ClickProvider,
  type ClickCallback,
} from '../src/payments/click.provider.js';

const SECRET = 'sinov-maxfiy-kalit-12345';

const provider = new ClickProvider({
  serviceId: '11111',
  merchantId: '22222',
  secretKey: SECRET,
  merchantUserId: '33333',
});

/** Click hujjatlaridagi formula bo'yicha to'g'ri imzo quradi. */
function sign(cb: Omit<ClickCallback, 'sign_string'>): string {
  const isComplete = cb.action === String(CLICK_ACTION.COMPLETE);
  const parts = [
    cb.click_trans_id,
    cb.service_id,
    SECRET,
    cb.merchant_trans_id,
    ...(isComplete ? [cb.merchant_prepare_id ?? ''] : []),
    cb.amount,
    cb.action,
    cb.sign_time,
  ];
  return createHash('md5').update(parts.join(''), 'utf8').digest('hex');
}

function prepare(overrides: Partial<ClickCallback> = {}): ClickCallback {
  const base = {
    click_trans_id: '1234567890',
    service_id: '11111',
    merchant_trans_id: 'a1b2c3d4-0000-0000-0000-000000000000',
    amount: '10000.00',
    action: String(CLICK_ACTION.PREPARE),
    error: '0',
    sign_time: '2026-08-15 12:00:00',
  } satisfies Omit<ClickCallback, 'sign_string'>;

  const merged = { ...base, ...overrides };
  return { ...merged, sign_string: overrides.sign_string ?? sign(merged) };
}

function complete(overrides: Partial<ClickCallback> = {}): ClickCallback {
  const base = {
    click_trans_id: '1234567890',
    service_id: '11111',
    merchant_trans_id: 'a1b2c3d4-0000-0000-0000-000000000000',
    merchant_prepare_id: 'inv-99',
    amount: '10000.00',
    action: String(CLICK_ACTION.COMPLETE),
    error: '0',
    sign_time: '2026-08-15 12:05:00',
  } satisfies Omit<ClickCallback, 'sign_string'>;

  const merged = { ...base, ...overrides };
  return { ...merged, sign_string: overrides.sign_string ?? sign(merged) };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('Click imzo tekshiruvi', () => {
  it('to\'g\'ri Prepare imzosini qabul qiladi', () => {
    expect(provider.verifySignature(prepare())).toBe(true);
  });

  it('to\'g\'ri Complete imzosini qabul qiladi', () => {
    expect(provider.verifySignature(complete())).toBe(true);
  });

  it('Prepare va Complete formulalari BOSHQACHA', () => {
    // Complete'da `merchant_prepare_id` ham imzoga kiradi. Agar ikkalasi
    // bir xil formula bilan hisoblansa, hujumchi Prepare imzosini
    // Complete uchun qayta ishlatib pul yozdirishi mumkin bo'lardi.
    const p = prepare();
    const c = complete({
      click_trans_id: p.click_trans_id,
      amount: p.amount,
      sign_time: p.sign_time,
      sign_string: p.sign_string, // Prepare imzosi
    });
    expect(provider.verifySignature(c)).toBe(false);
  });

  it('BOSHQA kalit bilan imzolanganini rad etadi', () => {
    const cb = prepare();
    const foreign = new ClickProvider({
      serviceId: '11111',
      merchantId: '22222',
      secretKey: 'boshqa-kalit',
      merchantUserId: '33333',
    });
    // Bizning kalit bilan imzolangan — begona provayder rad etishi kerak
    expect(foreign.verifySignature(cb)).toBe(false);
  });

  it('imzosiz so\'rovni rad etadi', () => {
    expect(provider.verifySignature(prepare({ sign_string: '' }))).toBe(false);
  });

  it('SUMMA o\'zgartirilsa rad etadi', () => {
    // Eng muhim hujum: summani oshirib yuborish
    const cb = prepare();
    const tampered: ClickCallback = { ...cb, amount: '99999.00' };
    expect(provider.verifySignature(tampered)).toBe(false);
  });

  it('merchant_trans_id o\'zgartirilsa rad etadi', () => {
    // Boshqa odamning savdosiga to'lovni bog'lab yuborish urinishi
    const cb = prepare();
    const tampered: ClickCallback = { ...cb, merchant_trans_id: 'boshqa-savdo' };
    expect(provider.verifySignature(tampered)).toBe(false);
  });

  it('sign_time o\'zgartirilsa rad etadi', () => {
    const cb = prepare();
    expect(provider.verifySignature({ ...cb, sign_time: '2020-01-01 00:00:00' })).toBe(false);
  });

  it('katta-kichik harf farq qilmaydi', () => {
    // Click imzoni katta harfda yuborsa ham qabul qilinishi kerak
    const cb = prepare();
    expect(provider.verifySignature({ ...cb, sign_string: cb.sign_string.toUpperCase() })).toBe(true);
  });

  it('kalit sozlanmagan bo\'lsa HAMMASINI rad etadi', () => {
    // Yarim sozlangan holatda "hamma imzo to'g'ri" bo'lib qolmasin
    const unconfigured = new ClickProvider({
      serviceId: '1',
      merchantId: '2',
      secretKey: '',
      merchantUserId: '4',
    });
    expect(unconfigured.verifySignature(prepare())).toBe(false);
  });
});

describe('Click summa o\'girish', () => {
  it('kasrli summani tiyinga to\'g\'ri o\'giradi', () => {
    expect(provider.fromSom('10000.00')).toBe(1_000_000n);
    expect(provider.fromSom('1000')).toBe(100_000n);
    expect(provider.fromSom('1234.56')).toBe(123_456n);
  });

  it('bir xonali kasrni o\'nlik ulush deb o\'qiydi', () => {
    // "1000.5" = 1000 so'm 50 tiyin, 5 tiyin EMAS
    expect(provider.fromSom('1000.5')).toBe(100_050n);
  });

  it('vergul bilan kelganini ham o\'qiydi', () => {
    expect(provider.fromSom('1000,25')).toBe(100_025n);
  });

  it('katta summada tiyin YO\'QOLMAYDI', () => {
    // parseFloat ishlatilsa bu yerda xato chiqardi
    expect(provider.fromSom('99999999.99')).toBe(9_999_999_999n);
  });

  it('tushunarsiz summani RAD ETADI', () => {
    // Jimgina 0 qaytarish — savdoni "0 so'mga to'langan" qilib qo'yardi
    for (const bad of ['abc', '', '10.999', '-100', '1e5']) {
      expect(() => provider.fromSom(bad), bad).toThrow();
    }
  });
});

describe('Click to\'lov havolasi', () => {
  it('kerakli parametrlar bilan quriladi', async () => {
    const invoice = await provider.createInvoice({
      dealId: 'deal-1',
      amountTiyin: 1_000_000n,
      returnUrl: 'https://ishonchli.uz/deals/deal-1',
      webhookUrl: 'https://api.ishonchli.uz/webhooks/click/complete',
      description: 'Sinov',
    });

    const url = new URL(invoice.payUrl);
    expect(url.origin + url.pathname).toBe('https://my.click.uz/services/pay');
    expect(url.searchParams.get('service_id')).toBe('11111');
    expect(url.searchParams.get('merchant_id')).toBe('22222');
    // Click SO'M kutadi, tiyin emas
    expect(url.searchParams.get('amount')).toBe('10000');
    expect(url.searchParams.get('transaction_param')).toBe(invoice.invoiceId);
  });

  it('har safar YANGI invoiceId beradi', async () => {
    const params = {
      dealId: 'deal-1',
      amountTiyin: 1_000_000n,
      returnUrl: 'https://x.uz',
      webhookUrl: 'https://x.uz/w',
      description: 'x',
    };
    const a = await provider.createInvoice(params);
    const b = await provider.createInvoice(params);
    expect(a.invoiceId).not.toBe(b.invoiceId);
  });

  it('butun so\'mga bo\'linmaydigan summani RAD ETADI', async () => {
    // Yaxlitlash = har to'lovda tiyin yo'qolishi
    await expect(
      provider.createInvoice({
        dealId: 'deal-1',
        amountTiyin: 1_000_001n,
        returnUrl: 'https://x.uz',
        webhookUrl: 'https://x.uz/w',
        description: 'x',
      }),
    ).rejects.toThrow();
  });
});

describe('Click imkoniyatlari', () => {
  it('webhook IMZOLANGAN deb belgilangan', () => {
    // checkout.uz'dan asosiy farq — bu bayroq webhook ishlov berish
    // mantig'ini boshqaradi
    expect(provider.webhookIsSigned).toBe(true);
  });

  it('pul chiqarish qo\'llab-quvvatlanmaydi — qo\'lda bajariladi', () => {
    expect(provider.supportsPayout).toBe(false);
  });

  it('payout XATO TASHLAMAYDI, ok:false qaytaradi', async () => {
    // Xato tashlansa foydalanuvchi "xatolik yuz berdi" ko'rardi va
    // puli qayerdaligini bilmasdi. `ok:false` — admin navbatiga tushadi.
    const res = await provider.payout({
      userId: 'u1',
      amountTiyin: 100_000n,
      destination: '8600****1234',
      idempotencyKey: 'k1',
    });
    expect(res.ok).toBe(false);
  });

  it('umumiy webhook interfeysi ishlatilmaydi', () => {
    // Click Prepare/Complete marshrutlari orqali ketadi
    expect(provider.parseWebhook().ok).toBe(false);
  });

  it('so\'m talab qiladi va chegaralari mantiqiy', () => {
    expect(provider.limits.requiresWholeSom).toBe(true);
    expect(provider.limits.minAmountTiyin).toBeLessThan(provider.limits.maxAmountTiyin);
    expect(provider.limits.minAmountTiyin % 100n).toBe(0n);
  });
});
