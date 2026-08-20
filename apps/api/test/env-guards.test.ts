/**
 * Sozlama himoyalari HAQIQATAN bloklaydimi.
 *
 * `config/env.ts` xato sozlamada `process.exit(1)` qiladi — ya'ni uni oddiy
 * import bilan sinab bo'lmaydi, test jarayonining o'zi o'lardi. Shuning uchun
 * har bir holat ALOHIDA jarayonda ishga tushiriladi va chiqish kodi tekshiriladi.
 *
 * Bu testlar bazaga tegmaydi.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { writeFileSync, unlinkSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

const apiRoot = fileURLToPath(new URL('..', import.meta.url));

// Vaqtinchalik yuklovchi: `config/env.ts` ni import qiladi, xolos.
// Sozlamalar unga MUHIT orqali beriladi (pastdagi `probe`), fayldan emas.
const loaderPath = `${apiRoot}.env-guard-probe.ts`;
writeFileSync(
  loaderPath,
  `await import('./src/config/env.js');
console.log('STARTED');
`,
);

afterAll(() => {
  try {
    unlinkSync(loaderPath);
  } catch {
    /* fayl allaqachon o'chirilgan */
  }
});

/**
 * Har bir probe uchun TO'LIQ va MUSTAQIL sozlama to'plami.
 *
 * ⚠️ Nega bu shunchalik muhim: ilgari testlar faqat FARQ qiladigan
 * qiymatni berardi, qolgani ishlab chiquvchining `.env` faylidan kelardi.
 * Natijada testlar lokalda o'tib, CI'da yiqilardi — u yerda `.env` YO'Q,
 * ya'ni masalan `CHECKOUT_UZ_API_KEY` bo'sh bo'lib, "sozlamalar to'liq
 * emas" himoyasi oldinroq ishlab ketardi va test sinamoqchi bo'lgan
 * himoyaga umuman yetib bormasdi.
 *
 * Shu sababli probe muhitni MEROS QILIB OLMAYDI — quyidagi to'plam
 * (ustiga test bergan o'zgarishlar) uning butun dunyosi.
 */
const BASE_ENV: Readonly<Record<string, string>> = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/escrowuz',
  DIRECT_URL: 'postgresql://u:p@localhost:5432/escrowuz',
  JWT_SECRET: 'A'.repeat(48),
  JWT_REFRESH_SECRET: 'B'.repeat(48),
  CREDENTIALS_SECRET: 'C'.repeat(48),
  CORS_ORIGINS: 'http://localhost:3000',
  PAYMENT_PROVIDER: 'mock',
  // checkout.uz uchun "to'liq sozlangan" bazaviy holat — testlar kerakli
  // bittasini bo'shatib, aynan o'sha himoyani sinaydi.
  CHECKOUT_UZ_BASE_URL: 'https://api.checkout.uz',
  CHECKOUT_UZ_API_KEY: 'test-api-key',
  CHECKOUT_UZ_ENV: 'sandbox',
  CHECKOUT_UZ_WEBHOOK_URL: 'https://example.uz/webhooks/checkout-uz',
  CLICK_SERVICE_ID: '',
  CLICK_MERCHANT_ID: '',
  CLICK_SECRET_KEY: '',
  CLICK_MERCHANT_USER_ID: '',
  EMAIL_DRIVER: 'log',
};

interface ProbeResult {
  started: boolean;
  output: string;
}

async function probe(overrides: Record<string, string>): Promise<ProbeResult> {
  try {
    const { stdout, stderr } = await execFileAsync('npx', ['tsx', loaderPath], {
      cwd: apiRoot,
      timeout: 60_000,
      // `env` berilgani uchun bola jarayon ota muhitini MEROS OLMAYDI.
      // PATH va HOME `npx`/`tsx` ishlashi uchun kerak, qolganini biz beramiz.
      env: {
        PATH: process.env['PATH'] ?? '',
        HOME: process.env['HOME'] ?? '',
        ...BASE_ENV,
        ...overrides,
      },
    });
    return { started: stdout.includes('STARTED'), output: stdout + stderr };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    return { started: false, output: (e.stdout ?? '') + (e.stderr ?? '') };
  }
}

describe('To\'lov provayderi sozlamalari', () => {
  it('mock bilan normal ishga tushadi', async () => {
    const r = await probe({ PAYMENT_PROVIDER: 'mock', NODE_ENV: 'development' });
    expect(r.started, r.output).toBe(true);
  });

  it('checkout_uz + sandbox BLOKLANADI (sandbox mavjud emas)', async () => {
    // checkout.uz'da test muhiti yo'q — "sandbox" deb o'ylab haqiqiy pul
    // yo'qotmaslik uchun ataylab to'siladi.
    //
    // Qolgan sozlamalar TO'LIQ beriladi: aks holda "sozlamalar to'liq emas"
    // tekshiruvi oldinroq ishlab, aynan sandbox himoyasi sinalmay qolardi.
    const r = await probe({
      PAYMENT_PROVIDER: 'checkout_uz',
      CHECKOUT_UZ_ENV: 'sandbox',
      CHECKOUT_UZ_WEBHOOK_URL: 'https://example.uz/webhooks/checkout-uz',
      NODE_ENV: 'development',
    });
    expect(r.started).toBe(false);
    expect(r.output).toContain('sandbox muhiti YO\'Q');
  });

  it('checkout_uz + API kalitsiz BLOKLANADI', async () => {
    const r = await probe({
      PAYMENT_PROVIDER: 'checkout_uz',
      CHECKOUT_UZ_ENV: 'production',
      CHECKOUT_UZ_API_KEY: '',
      NODE_ENV: 'development',
    });
    expect(r.started).toBe(false);
    expect(r.output).toContain('CHECKOUT_UZ_API_KEY');
  });

  it('checkout_uz + webhook manzilisiz BLOKLANADI', async () => {
    // Webhook manzilisiz to'lov haqida xabar kelmaydi va savdo 48 soatdan
    // keyin EXPIRED bo'ladi — pul to'langan bo'lsa ham.
    const r = await probe({
      PAYMENT_PROVIDER: 'checkout_uz',
      CHECKOUT_UZ_ENV: 'production',
      CHECKOUT_UZ_WEBHOOK_URL: '',
      NODE_ENV: 'development',
    });
    expect(r.started).toBe(false);
    expect(r.output).toContain('CHECKOUT_UZ_WEBHOOK_URL');
  });

  it('checkout_uz to\'liq sozlanganda ishga tushadi va OGOHLANTIRADI', async () => {
    const r = await probe({
      PAYMENT_PROVIDER: 'checkout_uz',
      CHECKOUT_UZ_ENV: 'production',
      CHECKOUT_UZ_WEBHOOK_URL: 'https://example.uz/webhooks/checkout-uz',
      NODE_ENV: 'development',
    });
    expect(r.started, r.output).toBe(true);
    expect(r.output).toContain('HAQIQIY pul');
  });

  it('production muhitida mock BLOKLANADI', async () => {
    // Mock pulsiz savdoni "to'langan" deb belgilaydi
    const r = await probe({ PAYMENT_PROVIDER: 'mock', NODE_ENV: 'production' });
    expect(r.started).toBe(false);
    expect(r.output).toContain('mock');
  });
});

describe('Click sozlamalari', () => {
  const FULL = {
    PAYMENT_PROVIDER: 'click',
    CLICK_SERVICE_ID: '11111',
    CLICK_MERCHANT_ID: '22222',
    CLICK_SECRET_KEY: 'maxfiy-kalit',
    CLICK_MERCHANT_USER_ID: '33333',
    NODE_ENV: 'development',
  };

  it('to\'liq sozlanganda ishga tushadi va OGOHLANTIRADI', async () => {
    const r = await probe(FULL);
    expect(r.started, r.output).toBe(true);
    // Click'da sandbox yo'q — har to'lov haqiqiy pul
    expect(r.output).toContain('HAQIQIY');
  });

  // Har bir kalit ALOHIDA majburiy: bittasi yetishmasa ham to'lov
  // oqimi buziladi, lekin buni faqat xaridor pul to'lash paytida
  // bilib qolardik.
  for (const missing of [
    'CLICK_SERVICE_ID',
    'CLICK_MERCHANT_ID',
    'CLICK_SECRET_KEY',
    'CLICK_MERCHANT_USER_ID',
  ]) {
    it(`${missing} bo'sh bo'lsa BLOKLANADI`, async () => {
      const r = await probe({ ...FULL, [missing]: '' });
      expect(r.started, r.output).toBe(false);
      // Xato xabari qaysi o'zgaruvchi yetishmayotganini ANIQ aytishi kerak
      expect(r.output).toContain(missing);
    });
  }
});

describe('Auth sozlamalari', () => {
  it('JWT sirlari bir xil bo\'lsa BLOKLANADI', async () => {
    // Aks holda access tokenni refresh sifatida ishlatib bo'lardi
    const same = 'x'.repeat(48);
    const r = await probe({
      JWT_SECRET: same,
      JWT_REFRESH_SECRET: same,
      NODE_ENV: 'development',
    });
    expect(r.started).toBe(false);
    expect(r.output).toContain('bir xil');
  });

  it('juda qisqa JWT siri BLOKLANADI', async () => {
    const r = await probe({ JWT_SECRET: 'qisqa', NODE_ENV: 'development' });
    expect(r.started).toBe(false);
    expect(r.output).toContain('JWT_SECRET');
  });

  it('production muhitida dev sirlari BLOKLANADI', async () => {
    // `dev-only` prefiksi ATAYLAB shu yerda yoziladi. Ilgari u ishlab
    // chiquvchining `.env` faylidan kelardi — ya'ni test o'z shartini
    // o'zi qo'ymasdi va boshqa mashinada ma'nosini yo'qotardi.
    const r = await probe({
      NODE_ENV: 'production',
      JWT_SECRET: `dev-only-${'x'.repeat(40)}`,
      PAYMENT_PROVIDER: 'checkout_uz',
      CHECKOUT_UZ_ENV: 'production',
      CHECKOUT_UZ_WEBHOOK_URL: 'https://example.uz/w',
    });
    expect(r.started, r.output).toBe(false);
    expect(r.output).toContain('development sirlari');
  });

  it('production muhitida CORS "*" BLOKLANADI', async () => {
    const r = await probe({
      NODE_ENV: 'production',
      CORS_ORIGINS: '*',
      JWT_SECRET: 'A'.repeat(48),
      JWT_REFRESH_SECRET: 'B'.repeat(48),
      PAYMENT_PROVIDER: 'checkout_uz',
      CHECKOUT_UZ_ENV: 'production',
      CHECKOUT_UZ_WEBHOOK_URL: 'https://example.uz/w',
    });
    expect(r.started).toBe(false);
    expect(r.output).toContain('CORS_ORIGINS');
  });
});
