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
const envPath = fileURLToPath(new URL('../../../.env', import.meta.url));

// Vaqtinchalik yuklovchi: .env ni o'qiydi, keyin sozlamalarni almashtirib
// `config/env.ts` ni import qiladi.
const loaderPath = `${apiRoot}.env-guard-probe.ts`;
writeFileSync(
  loaderPath,
  `process.loadEnvFile(${JSON.stringify(envPath)});
const overrides = JSON.parse(process.argv[2] ?? '{}');
for (const [k, v] of Object.entries(overrides)) process.env[k] = String(v);
await import('./src/config/env.js');
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

interface ProbeResult {
  started: boolean;
  output: string;
}

async function probe(overrides: Record<string, string>): Promise<ProbeResult> {
  try {
    const { stdout, stderr } = await execFileAsync(
      'npx',
      ['tsx', loaderPath, JSON.stringify(overrides)],
      { cwd: apiRoot, timeout: 60_000 },
    );
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
    const r = await probe({
      NODE_ENV: 'production',
      PAYMENT_PROVIDER: 'checkout_uz',
      CHECKOUT_UZ_ENV: 'production',
      CHECKOUT_UZ_WEBHOOK_URL: 'https://example.uz/w',
    });
    expect(r.started).toBe(false);
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
