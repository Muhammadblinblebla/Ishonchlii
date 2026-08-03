import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTestUsers, makeApp, prisma, uniqueEmail } from './helpers/setup.js';
import { hashRefreshToken } from '../src/lib/tokens.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await makeApp();
});

afterAll(async () => {
  await app.close();
  await cleanupTestUsers();
  await prisma.$disconnect();
});

const VALID_PASSWORD = 'MahkamParol123!';

async function registerUser(email = uniqueEmail()) {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, password: VALID_PASSWORD, fullName: 'Test Foydalanuvchi' },
  });
  return { res, email, body: res.json() as Record<string, any> };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('POST /auth/register', () => {
  it('yangi foydalanuvchi yaratadi va tokenlar qaytaradi', async () => {
    const { res, body, email } = await registerUser();

    expect(res.statusCode).toBe(201);
    expect(body['user'].email).toBe(email);
    expect(body['user'].role).toBe('user');
    expect(body['accessToken']).toBeTruthy();
    expect(body['refreshToken']).toBeTruthy();
  });

  it('javobda parol hashi CHIQMAYDI', async () => {
    const { body, res } = await registerUser();
    // Butun javobni matn sifatida tekshiramiz — ichma-ich obyektda
    // qolib ketgan maydonni ham tutish uchun.
    expect(res.body).not.toContain('passwordHash');
    expect(res.body).not.toContain('$argon2');
    expect(body['user']).not.toHaveProperty('passwordHash');
  });

  it('parol bazada ochiq holda saqlanmaydi', async () => {
    const { email } = await registerUser();
    const user = await prisma.user.findUnique({ where: { email } });

    expect(user!.passwordHash).not.toBe(VALID_PASSWORD);
    expect(user!.passwordHash.startsWith('$argon2id$')).toBe(true);
  });

  it('refresh token bazada OCHIQ holda saqlanmaydi', async () => {
    const { body } = await registerUser();
    const raw = body['refreshToken'] as string;

    const stored = await prisma.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(raw) },
    });
    expect(stored).not.toBeNull();

    // Ochiq token bilan qidirsak topilmasligi kerak
    const byRaw = await prisma.refreshToken.findUnique({ where: { tokenHash: raw } });
    expect(byRaw).toBeNull();
  });

  it('bir xil email ikki marta ro\'yxatdan o\'ta olmaydi', async () => {
    const email = uniqueEmail();
    await registerUser(email);
    const { res } = await registerUser(email);

    expect(res.statusCode).toBe(409);
    // Qaysi maydon band ekani aytilmasligi kerak (email enumeratsiya himoyasi)
    expect(res.json().error.message).not.toMatch(/email/i);
  });

  it('8 belgidan qisqa parolni rad etadi (§11)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: uniqueEmail(), password: 'qisqa1', fullName: 'Test' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('noto\'g\'ri email formatini rad etadi', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'email-emas', password: VALID_PASSWORD, fullName: 'Test' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('emailni kichik harfga keltiradi', async () => {
    const email = uniqueEmail();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: email.toUpperCase(), password: VALID_PASSWORD, fullName: 'Test' },
    });
    expect(res.statusCode).toBe(201);
    expect((res.json() as Record<string, any>)['user'].email).toBe(email.toLowerCase());
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('POST /auth/login', () => {
  it('to\'g\'ri parol bilan kirish', async () => {
    const { email } = await registerUser();

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password: VALID_PASSWORD },
    });

    expect(res.statusCode).toBe(200);
    expect((res.json() as Record<string, any>)['accessToken']).toBeTruthy();
  });

  it('noto\'g\'ri parolni rad etadi', async () => {
    const { email } = await registerUser();

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password: 'BoshqaParol999!' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('mavjud emas va noto\'g\'ri parol xatolari BIR XIL (email enumeratsiya himoyasi)', async () => {
    const { email } = await registerUser();

    const wrongPassword = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password: 'NotoGriParol1!' },
    });

    const noSuchUser = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: uniqueEmail('yoq'), password: 'NotoGriParol1!' },
    });

    expect(wrongPassword.statusCode).toBe(noSuchUser.statusCode);
    expect(wrongPassword.json().error.message).toBe(noSuchUser.json().error.message);
  });

  it('o\'chirilgan hisob kira olmaydi', async () => {
    const { email } = await registerUser();
    await prisma.user.update({ where: { email }, data: { deletedAt: new Date() } });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password: VALID_PASSWORD },
    });

    expect(res.statusCode).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('POST /auth/refresh — token rotatsiyasi', () => {
  it('yangi juftlik qaytaradi va eski refresh token ISHLAMAY QOLADI', async () => {
    const { body } = await registerUser();
    const oldToken = body['refreshToken'] as string;

    const first = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: oldToken },
    });
    expect(first.statusCode).toBe(200);

    const newToken = (first.json() as Record<string, any>)['refreshToken'] as string;
    expect(newToken).not.toBe(oldToken);

    // Eski token endi ishlamasligi kerak
    const reuse = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: oldToken },
    });
    expect(reuse.statusCode).toBe(401);
  });

  it('eski token qayta ishlatilsa BARCHA sessiyalar yopiladi', async () => {
    const { body, email } = await registerUser();
    const stolenToken = body['refreshToken'] as string;

    // Haqiqiy egasi tokenni almashtiradi
    const rotated = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: stolenToken },
    });
    const freshToken = (rotated.json() as Record<string, any>)['refreshToken'] as string;

    // "O'g'ri" eski nusxa bilan keladi → o'g'irlik aniqlanadi
    const attack = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: stolenToken },
    });
    expect(attack.statusCode).toBe(401);

    // Endi HAQIQIY egasining yangi tokeni ham bekor qilingan bo'lishi kerak
    const victim = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: freshToken },
    });
    expect(victim.statusCode).toBe(401);

    const user = await prisma.user.findUnique({ where: { email } });
    const active = await prisma.refreshToken.count({
      where: { userId: user!.id, revokedAt: null },
    });
    expect(active).toBe(0);
  });

  it('muddati tugagan tokenni rad etadi', async () => {
    const { body } = await registerUser();
    const token = body['refreshToken'] as string;

    await prisma.refreshToken.update({
      where: { tokenHash: hashRefreshToken(token) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: token },
    });
    expect(res.statusCode).toBe(401);
  });

  it('o\'ylab topilgan tokenni rad etadi', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: 'butunlay-soxta-token-12345' },
    });
    expect(res.statusCode).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('GET /auth/me — himoyalangan marshrut', () => {
  it('haqiqiy token bilan profil qaytaradi', async () => {
    const { body, email } = await registerUser();

    const res = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${body['accessToken']}` },
    });

    expect(res.statusCode).toBe(200);
    expect((res.json() as Record<string, any>)['user'].email).toBe(email);
  });

  it('tokensiz 401 qaytaradi', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/me' });
    expect(res.statusCode).toBe(401);
  });

  it('buzilgan token bilan 401 qaytaradi', async () => {
    const { body } = await registerUser();
    const broken = (body['accessToken'] as string).slice(0, -3) + 'xxx';

    const res = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${broken}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('`alg: none` hujumini bloklaydi', async () => {
    // Imzosiz, `alg: none` bilan yasalgan token
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        sub: '11111111-1111-1111-1111-111111111111',
        role: 'admin',
        iss: 'escrowuz',
        aud: 'escrowuz-api',
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString('base64url');

    const res = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${header}.${payload}.` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('token amal qilsa ham o\'chirilgan hisob kira olmaydi', async () => {
    const { body, email } = await registerUser();
    // Access token 15 daqiqa yashaydi — hisob o'chirilsa o'sha zahoti to'silishi kerak
    await prisma.user.update({ where: { email }, data: { deletedAt: new Date() } });

    const res = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${body['accessToken']}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rol TOKENDAN emas, bazadan olinadi', async () => {
    // Foydalanuvchi 'user' sifatida ro'yxatdan o'tadi va token oladi
    const { body, email } = await registerUser();
    const token = body['accessToken'] as string;

    // Bazada admin qilinadi — eski token baribir yangi rolni ko'rishi kerak
    await prisma.user.update({ where: { email }, data: { role: 'admin' } });

    const res = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as Record<string, any>)['user'].role).toBe('admin');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('POST /auth/logout', () => {
  it('refresh tokenni bekor qiladi', async () => {
    const { body } = await registerUser();
    const token = body['refreshToken'] as string;

    const out = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      payload: { refreshToken: token },
    });
    expect(out.statusCode).toBe(204);

    const after = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: token },
    });
    expect(after.statusCode).toBe(401);
  });
});
