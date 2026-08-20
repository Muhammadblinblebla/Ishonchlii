/**
 * FRONTEND CHAQIRADIGAN HAR BIR MANZIL MAVJUDMI.
 *
 * Nega bu test bor: refaktoring paytida `/deals/:id/confirm` marshruti
 * tasodifan o'chib ketdi. Typecheck buni TUTMAYDI — frontend manzilni
 * satr sifatida yozadi, server esa uni bilmasa 404 qaytaradi.
 *
 * Foydalanuvchi uchun bu shunday ko'rinardi: "Ha, pulni o'tkazing"
 * tugmasi bosiladi va "Bunday manzil topilmadi" chiqadi. Pul escrowda
 * qolib ketadi va savdo hech qachon yakunlanmaydi.
 *
 * Test BAZAGA TEGMAYDI: har bir manzilga tokensiz so'rov yuboriladi va
 * javob 404 EMASLIGI tekshiriladi. 401 (avtorizatsiya kerak) — bu
 * marshrut MAVJUD degani, bizga shuni bilish kifoya.
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

let app: FastifyInstance;

const UUID = '00000000-0000-4000-8000-000000000000';

/** `apps/web/src/lib/api.ts` dagi har bir chaqiruv. */
const ROUTES: Array<{ method: 'GET' | 'POST'; url: string; what: string }> = [
  // Auth
  { method: 'POST', url: '/auth/register', what: 'ro\'yxatdan o\'tish' },
  { method: 'POST', url: '/auth/login', what: 'kirish' },
  { method: 'POST', url: '/auth/logout', what: 'chiqish' },
  { method: 'POST', url: '/auth/refresh', what: 'token yangilash' },
  { method: 'GET', url: '/auth/me', what: 'profil' },

  // Savdolar
  { method: 'POST', url: '/deals', what: 'savdo yaratish' },
  { method: 'GET', url: '/deals', what: 'savdolar ro\'yxati' },
  { method: 'GET', url: '/deals/preview?amountTiyin=100000', what: 'hisob-kitob' },
  { method: 'POST', url: '/deals/find', what: 'kalit so\'z bilan topish' },
  { method: 'GET', url: `/deals/${UUID}`, what: 'savdo sahifasi' },
  { method: 'GET', url: `/deals/${UUID}/events`, what: 'voqealar tarixi' },
  { method: 'POST', url: `/deals/${UUID}/claim`, what: 'savdoni band qilish' },
  { method: 'POST', url: `/deals/${UUID}/pay`, what: 'to\'lov havolasi' },
  { method: 'POST', url: `/deals/${UUID}/ship`, what: 'topshirish' },
  { method: 'GET', url: `/deals/${UUID}/content`, what: 'raqamli mahsulot' },
  // ⚠️ AYNAN SHU MARSHRUT o'chib ketgan edi
  { method: 'POST', url: `/deals/${UUID}/confirm`, what: 'TASDIQLASH — pulni o\'tkazish' },
  { method: 'POST', url: `/deals/${UUID}/cancel`, what: 'bekor qilish' },
  { method: 'POST', url: `/deals/${UUID}/dispute`, what: 'nizo ochish' },

  // Chat
  { method: 'GET', url: `/deals/${UUID}/messages`, what: 'chatni o\'qish' },
  { method: 'POST', url: `/deals/${UUID}/messages`, what: 'xabar yuborish' },

  // Hamyon
  { method: 'GET', url: '/wallet', what: 'balans' },
  { method: 'GET', url: '/wallet/transactions', what: 'tranzaksiyalar' },
  { method: 'POST', url: '/wallet/payout', what: 'pul yechish' },

  // Admin
  { method: 'GET', url: '/admin/stats', what: 'admin statistikasi' },
  { method: 'GET', url: '/admin/disputes', what: 'nizolar ro\'yxati' },
  { method: 'GET', url: `/admin/disputes/${UUID}`, what: 'nizo tafsiloti' },
  { method: 'POST', url: `/admin/disputes/${UUID}/resolve`, what: 'nizoni hal qilish' },
  { method: 'GET', url: '/admin/payouts', what: 'to\'lov navbati' },
  { method: 'POST', url: `/admin/payouts/${UUID}/complete`, what: 'to\'lovni bajarish' },
  { method: 'POST', url: `/admin/payouts/${UUID}/reject`, what: 'to\'lovni rad etish' },

  // Click callback'lari — Click kabinetiga shu manzillar kiritiladi
  { method: 'POST', url: '/webhooks/click/prepare', what: 'Click Prepare' },
  { method: 'POST', url: '/webhooks/click/complete', what: 'Click Complete' },

  // Salomatlik
  { method: 'GET', url: '/health', what: 'health check' },
];

beforeAll(async () => {
  app = await buildApp({ rateLimiting: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('Frontend chaqiradigan barcha manzillar mavjud', () => {
  for (const { method, url, what } of ROUTES) {
    it(`${method} ${url} — ${what}`, async () => {
      const res = await (method === 'POST'
        ? app.inject({ method: 'POST', url, payload: {} })
        : app.inject({ method: 'GET', url }));

      // 404 = marshrut UMUMAN yo'q. Boshqa har qanday kod (401, 400, 403,
      // 500 — hatto bazaga ulanolmagani ham) marshrut MAVJUD degani.
      expect(
        res.statusCode,
        `${method} ${url} → 404. Marshrut o'chib ketgan yoki nomi o'zgargan.`,
      ).not.toBe(404);
    });
  }

  it('mavjud bo\'lmagan manzil HAQIQATAN 404 qaytaradi', async () => {
    // Test o'zi ishlayotganini tasdiqlaydi: agar hamma narsa 404 dan
    // boshqa narsa qaytarsa, yuqoridagi tekshiruvlar hech nima bermasdi.
    const res = await app.inject({ method: 'GET', url: '/bunday-manzil-yoq' });
    expect(res.statusCode).toBe(404);
  });
});
