/**
 * Rate limiting (§11): login 5/daqiqa.
 *
 * Bu testda chegaralar ATAYLAB yoqiladi — boshqa testlarda ular o'chiq,
 * chunki `app.inject` hamma so'rovni bitta IP'dan yuboradi.
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTestUsers, makeApp, prisma, uniqueEmail } from './helpers/setup.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await makeApp({ rateLimiting: true });
});

afterAll(async () => {
  await app.close();
  await cleanupTestUsers();
  await prisma.$disconnect();
});

/**
 * Chegara IP bo'yicha hisoblanadi. Har bir test O'Z IP'sidan yuboradi —
 * aks holda birinchi testda sarflangan limit ikkinchisiga o'tib ketadi va
 * test nima sababdan yiqilganini aytib bo'lmay qoladi.
 */
let ipCounter = 0;
function nextIp(): string {
  ipCounter++;
  return `203.0.113.${ipCounter}`; // TEST-NET-3 — hujjatlar uchun ajratilgan diapazon
}

describe('Rate limiting', () => {
  it('login 5 ta urinishdan keyin 429 qaytaradi (§11)', async () => {
    const ip = nextIp();
    const email = uniqueEmail('ratelimit');
    const statuses: number[] = [];

    for (let i = 0; i < 7; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        remoteAddress: ip,
        payload: { email, password: 'NotoGriParol1!' },
      });
      statuses.push(res.statusCode);
    }

    // Dastlabki 5 tasi chegaraga urilmaydi — parol noto'g'ri, ya'ni 401.
    // 500 chiqsa, bu baza muammosi (chegara emas) — shuni ajratib ko'rsatamiz.
    expect(statuses.slice(0, 5), `kutilgan: 5×401, olindi: ${statuses.join(',')}`)
      .toEqual([401, 401, 401, 401, 401]);

    // 6- va 7-si bloklanadi
    expect(statuses.slice(5)).toEqual([429, 429]);
  });

  it('429 javobi tushunarli xabar qaytaradi', async () => {
    const ip = nextIp();
    let limited: { code: number; body: any } | undefined;

    for (let i = 0; i < 7; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        remoteAddress: ip,
        payload: { email: uniqueEmail('rl2'), password: 'NotoGriParol1!' },
      });
      if (res.statusCode === 429) {
        limited = { code: res.statusCode, body: res.json() };
        break;
      }
    }

    expect(limited, '429 javobi umuman kelmadi').toBeDefined();
    expect(limited!.body.error.code).toBe('RATE_LIMITED');
    expect(limited!.body.error.message).toContain('so\'rov');
  });

  it('boshqa IP mustaqil chegaraga ega', async () => {
    // Bir foydalanuvchining bloklanishi boshqalarga ta'sir qilmasligi kerak
    const blockedIp = nextIp();
    for (let i = 0; i < 6; i++) {
      await app.inject({
        method: 'POST',
        url: '/auth/login',
        remoteAddress: blockedIp,
        payload: { email: uniqueEmail('rl3'), password: 'NotoGriParol1!' },
      });
    }

    const freshIp = nextIp();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      remoteAddress: freshIp,
      payload: { email: uniqueEmail('rl4'), password: 'NotoGriParol1!' },
    });

    expect(res.statusCode).toBe(401); // 429 emas
  });
});
