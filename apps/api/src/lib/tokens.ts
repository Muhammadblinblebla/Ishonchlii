/**
 * JWT access + refresh tokenlar.
 *
 * Access token  — qisqa muddatli (15 daq), bazaga tegmasdan tekshiriladi.
 * Refresh token — uzoq muddatli (30 kun), bazada HASHI saqlanadi va
 *                 har ishlatilganda ALMASHTIRILADI (rotation).
 *
 * Nega rotatsiya: refresh token o'g'irlansa, o'g'ri undan bir marta
 * foydalanadi, keyin haqiqiy foydalanuvchi eski token bilan kelganda
 * biz o'g'irlik sodir bo'lganini ANIQLAB, butun oilani bekor qilamiz.
 */

import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { createHash, randomBytes } from 'node:crypto';
import { env } from '../config/env.js';
import { ApiError } from './errors.js';

const accessKey = new TextEncoder().encode(env.JWT_SECRET);
const refreshKey = new TextEncoder().encode(env.JWT_REFRESH_SECRET);

const ISSUER = 'escrowuz';
const AUDIENCE = 'escrowuz-api';

export interface AccessTokenPayload extends JWTPayload {
  sub: string;
  role: 'user' | 'admin';
}

export async function signAccessToken(userId: string, role: 'user' | 'admin'): Promise<string> {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(env.JWT_ACCESS_TTL)
    .sign(accessKey);
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  try {
    const { payload } = await jwtVerify(token, accessKey, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'], // `alg: none` hujumini bloklaydi
    });
    if (typeof payload.sub !== 'string' || !payload.sub) {
      throw new Error('sub yo\'q');
    }
    const role = payload['role'];
    if (role !== 'user' && role !== 'admin') {
      throw new Error('role noto\'g\'ri');
    }
    return { ...payload, sub: payload.sub, role };
  } catch {
    throw ApiError.unauthorized('Token yaroqsiz yoki muddati tugagan');
  }
}

/**
 * Refresh token — JWT emas, oddiy tasodifiy satr.
 *
 * Nega JWT emas: refresh token baribir har safar bazadan tekshiriladi
 * (bekor qilinganmi?), shuning uchun JWT ichidagi ma'lumot ortiqcha.
 * Tasodifiy satr esa kichikroq va tahlil qilinadigan hech narsa bermaydi.
 */
export function generateRefreshToken(): string {
  return randomBytes(48).toString('base64url');
}

/** Bazada tokenning O'ZI emas, shu hash saqlanadi (baza sizsa ham foydasiz). */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** "30d" / "15m" / "3600" ko'rinishidagi muddatni millisekundga o'giradi. */
export function parseDuration(value: string): number {
  const m = /^(\d+)\s*([smhd])?$/.exec(value.trim());
  if (!m) throw new Error(`Muddat formati noto'g'ri: "${value}"`);
  const amount = Number(m[1]);
  const unit = m[2] ?? 's';
  const multiplier = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit]!;
  return amount * multiplier;
}

export function refreshTokenExpiry(): Date {
  return new Date(Date.now() + parseDuration(env.JWT_REFRESH_TTL));
}
