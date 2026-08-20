/**
 * Muhit o'zgaruvchilari — ishga tushishda TEKSHIRILADI.
 *
 * Nega: noto'g'ri sozlangan server ishlab ketib, keyin pul o'tkazish paytida
 * yiqilishidan ko'ra, umuman ishga tushmagani xavfsizroq.
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// Monorepo ildizidagi `.env` ni yuklaymiz.
//
// Production'da o'zgaruvchilar muhitdan keladi (Docker, hosting paneli) va
// `.env` fayli bo'lmaydi — shuning uchun mavjudligi tekshiriladi. `DATABASE_URL`
// allaqachon o'rnatilgan bo'lsa faylga umuman tegilmaydi: tashqi muhit
// har doim ustun turadi.
if (!process.env['DATABASE_URL']) {
  const envPath = fileURLToPath(new URL('../../../../.env', import.meta.url));
  if (existsSync(envPath)) process.loadEnvFile(envPath);
}

const isProd = process.env['NODE_ENV'] === 'production';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL to\'ldirilmagan'),
  DIRECT_URL: z.string().min(1).optional(),

  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  API_HOST: z.string().default('0.0.0.0'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET kamida 32 belgi bo\'lishi kerak'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET kamida 32 belgi bo\'lishi kerak'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),

  /**
   * O'yin akkauntlarining login/paroli shu kalit bilan shifrlanadi.
   *
   * ⚠️ O'ZGARTIRMANG: kalit almashsa, ALLAQACHON topshirilgan akkaunt
   * ma'lumotlarini ochib bo'lmaydi va xaridorlar o'zi sotib olgan
   * akkauntdan mahrum bo'ladi. JWT sirlaridan FARQLI o'laroq buni
   * muntazam aylantirib turish MUMKIN EMAS.
   */
  CREDENTIALS_SECRET: z.string().min(32, 'CREDENTIALS_SECRET kamida 32 belgi bo\'lishi kerak'),

  // §11: `*` qabul qilinmaydi
  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  REDIS_URL: z.string().default(''),

  PAYMENT_PROVIDER: z.enum(['mock', 'checkout_uz', 'click']).default('mock'),

  // ─── Click (SHOP API) ─────────────────────────────────────────────────────
  // Qiymatlar merchant.click.uz kabinetidan olinadi. To'rttasi ham majburiy.
  // CLICK_SECRET_KEY — callback imzosini tekshiradi: usiz istalgan odam
  // "to'lov keldi" deb yuborishi mumkin bo'lardi.
  CLICK_SERVICE_ID: z.string().default(''),
  CLICK_MERCHANT_ID: z.string().default(''),
  CLICK_SECRET_KEY: z.string().default(''),
  /** Merchant API (to'lov holatini so'rash) uchun foydalanuvchi ID. */
  CLICK_MERCHANT_USER_ID: z.string().default(''),

  // checkout.uz autentifikatsiyasi: Authorization: Bearer <API_KEY>.
  // merchant_id kerak emas — so'rovlarda bunday maydon yo'q.
  CHECKOUT_UZ_BASE_URL: z.string().default(''),
  CHECKOUT_UZ_API_KEY: z.string().default(''),
  /**
   * BIZNING xavfsizlik bayrog'imiz, provayderniki emas.
   * checkout.uz'da sandbox yo'q — har qanday to'lov HAQIQIY.
   * Shuning uchun "production" ni ataylab alohida yoqish kerak.
   */
  CHECKOUT_UZ_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  CHECKOUT_UZ_WEBHOOK_URL: z.string().default(''),

  // ─── Email ────────────────────────────────────────────────────────────────
  // `log`  — konsolga chiqaradi (standart). Hech qanday sozlama kerak emas.
  // `smtp` — haqiqiy yuborish. Har qanday SMTP xizmati bilan ishlaydi.
  EMAIL_DRIVER: z.enum(['log', 'smtp']).default('log'),
  EMAIL_FROM: z.string().default('ishonchli.uz <noreply@ishonchli.uz>'),
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_USER: z.string().default(''),
  SMTP_PASSWORD: z.string().default(''),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_PATH: z.string().default('./storage/uploads'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('\n  ❌ Muhit o\'zgaruvchilari noto\'g\'ri sozlangan:\n');
  for (const issue of parsed.error.issues) {
    console.error(`     ${issue.path.join('.')}: ${issue.message}`);
  }
  console.error('\n  .env faylini tekshiring (.env.example ga qarang).\n');
  process.exit(1);
}

const raw = parsed.data;

// Ikkala sir bir xil bo'lsa, access tokenni refresh sifatida ishlatib bo'ladi.
if (raw.JWT_SECRET === raw.JWT_REFRESH_SECRET) {
  console.error('\n  ❌ JWT_SECRET va JWT_REFRESH_SECRET bir xil bo\'lishi mumkin emas.\n');
  process.exit(1);
}

// Shifrlash kaliti JWT siri bilan bir xil bo'lsa: JWT sirini almashtirish
// (bu odatiy xavfsizlik amali) barcha akkaunt ma'lumotlarini o'qib
// bo'lmaydigan qilib qo'yardi.
if (
  raw.CREDENTIALS_SECRET === raw.JWT_SECRET ||
  raw.CREDENTIALS_SECRET === raw.JWT_REFRESH_SECRET
) {
  console.error(
    '\n  ❌ CREDENTIALS_SECRET JWT sirlaridan farq qilishi kerak.\n' +
      '     Aks holda JWT sirini almashtirish sotilgan akkauntlarni yo\'qotadi.\n',
  );
  process.exit(1);
}

const corsOrigins = raw.CORS_ORIGINS.split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// ─── To'lov provayderi to'liq sozlanganmi ────────────────────────────────────
//
// Yarim sozlangan provayder eng xavfli holat: server ko'tariladi, savdolar
// yaratiladi, xaridor to'lov havolasini bosadi — va shundagina hammasi
// buziladi. Shuning uchun tekshiruv ishga tushish paytida.
if (raw.PAYMENT_PROVIDER === 'checkout_uz') {
  const missing = (
    [
      ['CHECKOUT_UZ_BASE_URL', raw.CHECKOUT_UZ_BASE_URL],
      ['CHECKOUT_UZ_API_KEY', raw.CHECKOUT_UZ_API_KEY],
      // Webhook manzili ham majburiy: usiz to'lov haqida xabar kelmaydi va
      // savdo 48 soatdan keyin EXPIRED bo'lib ketadi — pul to'langan bo'lsa ham.
      ['CHECKOUT_UZ_WEBHOOK_URL', raw.CHECKOUT_UZ_WEBHOOK_URL],
    ] as const
  )
    .filter(([, value]) => value.trim() === '')
    .map(([name]) => name);

  if (missing.length > 0) {
    console.error('\n  ❌ PAYMENT_PROVIDER="checkout_uz", lekin sozlamalar to\'liq emas:\n');
    for (const name of missing) console.error(`     ${name}`);
    console.error('\n  .env ni to\'ldiring yoki PAYMENT_PROVIDER="mock" qiling.\n');
    process.exit(1);
  }

  // checkout.uz'da sandbox YO'Q — har qanday to'lov haqiqiy pul.
  // Shuning uchun development muhitida uni ishlatish ataylab qiyinlashtirilgan.
  if (raw.CHECKOUT_UZ_ENV !== 'production') {
    console.error(
      '\n  ❌ PAYMENT_PROVIDER="checkout_uz", lekin CHECKOUT_UZ_ENV="sandbox".\n' +
        '\n' +
        '     checkout.uz\'da sandbox muhiti YO\'Q — har qanday to\'lov HAQIQIY pul.\n' +
        '     Bu chalkashlikni oldini olish uchun ataylab bloklandi.\n' +
        '\n' +
        '     Sinash uchun:  PAYMENT_PROVIDER="mock"\n' +
        '     Haqiqiy ishga: CHECKOUT_UZ_ENV="production"\n',
    );
    process.exit(1);
  }

  if (!isProd) {
    console.warn(
      '\n  ⚠️  DIQQAT: checkout.uz yoqilgan, lekin NODE_ENV production emas.\n' +
        '     Yaratilgan har bir to\'lov HAQIQIY pul talab qiladi.\n' +
        '     Sinash uchun eng kichik summani (1 000 so\'m) ishlating.\n',
    );
  }
}

// Click tanlangan bo'lsa barcha kalitlar to'ldirilgan bo'lishi shart.
// Yarim sozlangan holat eng xavflisi: server ko'tariladi, savdolar yaratiladi,
// to'lov paytida hammasi buziladi.
if (raw.PAYMENT_PROVIDER === 'click') {
  const missing = (
    [
      ['CLICK_SERVICE_ID', raw.CLICK_SERVICE_ID],
      ['CLICK_MERCHANT_ID', raw.CLICK_MERCHANT_ID],
      ['CLICK_SECRET_KEY', raw.CLICK_SECRET_KEY],
      ['CLICK_MERCHANT_USER_ID', raw.CLICK_MERCHANT_USER_ID],
    ] as const
  )
    .filter(([, value]) => value.trim() === '')
    .map(([name]) => name);

  if (missing.length > 0) {
    console.error('\n  ❌ PAYMENT_PROVIDER="click", lekin sozlamalar to\'liq emas:\n');
    for (const name of missing) console.error(`     ${name}`);
    console.error('\n  Qiymatlar merchant.click.uz kabinetida. To\'ldiring yoki PAYMENT_PROVIDER="mock" qiling.\n');
    process.exit(1);
  }

  if (!isProd) {
    console.warn(
      '\n  ⚠️  DIQQAT: Click yoqilgan, lekin NODE_ENV production emas.\n' +
        '     Click\'da sandbox YO\'Q — har bir to\'lov HAQIQIY pul.\n' +
        '     Sinash uchun eng kichik summani (1 000 so\'m) ishlating.\n',
    );
  }
}

// SMTP tanlangan bo'lsa sozlamalari to'liq bo'lishi kerak.
if (raw.EMAIL_DRIVER === 'smtp' && raw.SMTP_HOST.trim() === '') {
  console.error(
    '\n  ❌ EMAIL_DRIVER="smtp", lekin SMTP_HOST to\'ldirilmagan.\n' +
      '     .env ni to\'ldiring yoki EMAIL_DRIVER="log" qiling.\n',
  );
  process.exit(1);
}

// Production'da `log` drayveri = foydalanuvchilar hech qanday xabar olmaydi.
// Savdo ishlaydi, lekin hech kim nima bo'layotganini bilmaydi.
if (isProd && raw.EMAIL_DRIVER === 'log') {
  console.warn(
    '\n  ⚠️  Production muhitida EMAIL_DRIVER="log" — xatlar YUBORILMAYDI.\n' +
      '     Foydalanuvchilar savdo holati o\'zgarganini bilmaydi.\n',
  );
}

// Production'da mock to'lov = pul kelmagan savdolar "to'langan" deb belgilanadi.
if (isProd && raw.PAYMENT_PROVIDER === 'mock') {
  console.error(
    '\n  ❌ Production muhitida PAYMENT_PROVIDER="mock" ishlatib bo\'lmaydi.\n' +
      '     Mock provayder haqiqiy pulsiz savdolarni "to\'langan" deb belgilaydi.\n',
  );
  process.exit(1);
}

if (isProd) {
  if (corsOrigins.includes('*')) {
    console.error('\n  ❌ Production muhitida CORS_ORIGINS="*" ishlatib bo\'lmaydi (§11).\n');
    process.exit(1);
  }
  if (raw.JWT_SECRET.startsWith('dev-only') || raw.JWT_REFRESH_SECRET.startsWith('dev-only')) {
    console.error('\n  ❌ Production muhitida development sirlari ishlatilmoqda.\n');
    process.exit(1);
  }
}

export const env = {
  ...raw,
  corsOrigins,
  isProd,
  isTest: raw.NODE_ENV === 'test',
} as const;

export type Env = typeof env;
