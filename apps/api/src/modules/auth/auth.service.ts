import type { User } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { STANDARD_TX } from '../../db/tx-options.js';
import { ApiError } from '../../lib/errors.js';
import { fakeVerify, hashPassword, verifyPassword } from '../../lib/password.js';
import {
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
  signAccessToken,
} from '../../lib/tokens.js';
import type { LoginInput, RegisterInput } from './auth.schemas.js';

export interface AuthContext {
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
}

export interface AuthResult {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
}

export interface PublicUser {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  role: 'user' | 'admin';
  isVerified: boolean;
  createdAt: Date;
}

/** Foydalanuvchi obyektidan tashqariga chiqishi mumkin bo'lgan maydonlar. */
export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    phone: user.phone,
    role: user.role,
    isVerified: user.isVerified,
    createdAt: user.createdAt,
  };
}

async function issueTokens(user: User, ctx: AuthContext): Promise<AuthResult> {
  const refreshToken = generateRefreshToken();

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt: refreshTokenExpiry(),
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    },
  });

  return {
    user: toPublicUser(user),
    accessToken: await signAccessToken(user.id, user.role),
    refreshToken,
  };
}

export async function register(input: RegisterInput, ctx: AuthContext): Promise<AuthResult> {
  const existing = await prisma.user.findFirst({
    where: {
      OR: [{ email: input.email }, ...(input.phone ? [{ phone: input.phone }] : [])],
    },
    select: { id: true },
  });

  if (existing) {
    // Qaysi maydon band ekanini aytmaymiz — bu email/telefon ro'yxatdan
    // o'tganini tekshirish vositasiga aylanib qolardi.
    throw ApiError.conflict('Bu email yoki telefon raqam allaqachon ro\'yxatdan o\'tgan');
  }

  const user = await prisma.user.create({
    data: {
      email: input.email,
      phone: input.phone ?? null,
      fullName: input.fullName,
      passwordHash: await hashPassword(input.password),
      role: 'user',
    },
  });

  return issueTokens(user, ctx);
}

export async function login(input: LoginInput, ctx: AuthContext): Promise<AuthResult> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });

  // Foydalanuvchi topilmasa ham argon2 hisob-kitobini bajaramiz, aks holda
  // javob vaqti email ro'yxatda bor-yo'qligini oshkor qiladi (timing attack).
  if (!user || user.deletedAt) {
    await fakeVerify(input.password);
    throw ApiError.unauthorized('Email yoki parol noto\'g\'ri');
  }

  if (!(await verifyPassword(user.passwordHash, input.password))) {
    throw ApiError.unauthorized('Email yoki parol noto\'g\'ri');
  }

  return issueTokens(user, ctx);
}

/**
 * Refresh token almashtirish (rotation) + qayta ishlatishni aniqlash.
 *
 * Bekor qilingan token qayta kelsa — bu o'g'irlik belgisi: haqiqiy egasi
 * allaqachon uni almashtirgan, demak eski nusxa boshqa birovda. Bunday
 * holatda foydalanuvchining BARCHA tokenlari bekor qilinadi.
 */
export async function refresh(rawToken: string, ctx: AuthContext): Promise<AuthResult> {
  const tokenHash = hashRefreshToken(rawToken);

  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!stored) {
    throw ApiError.unauthorized('Refresh token yaroqsiz');
  }

  if (stored.revokedAt) {
    // Qayta ishlatish aniqlandi — hamma sessiyani yopamiz.
    await prisma.refreshToken.updateMany({
      where: { userId: stored.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw ApiError.unauthorized(
      'Refresh token qayta ishlatilgan. Xavfsizlik uchun barcha sessiyalar yopildi.',
    );
  }

  if (stored.expiresAt <= new Date()) {
    throw ApiError.unauthorized('Refresh token muddati tugagan');
  }

  if (stored.user.deletedAt) {
    throw ApiError.unauthorized('Hisob o\'chirilgan');
  }

  // Eski tokenni bekor qilish va yangisini berish — bitta tranzaksiyada,
  // aks holda ikkita parallel so'rov ikkita amal qiluvchi token yaratib yuboradi.
  const rotated = await prisma.$transaction(async (tx) => {
    const revoked = await tx.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    // 0 ta qator yangilandi = boshqa so'rov bizdan oldin ulgurdi.
    if (revoked.count === 0) {
      throw ApiError.unauthorized('Refresh token allaqachon ishlatilgan');
    }

    const newToken = generateRefreshToken();
    await tx.refreshToken.create({
      data: {
        userId: stored.userId,
        tokenHash: hashRefreshToken(newToken),
        expiresAt: refreshTokenExpiry(),
        ipAddress: ctx.ipAddress ?? null,
        userAgent: ctx.userAgent ?? null,
      },
    });
    return newToken;
  }, STANDARD_TX);

  return {
    user: toPublicUser(stored.user),
    accessToken: await signAccessToken(stored.user.id, stored.user.role),
    refreshToken: rotated,
  };
}

/** Chiqish — faqat shu qurilmadagi sessiya yopiladi. */
export async function logout(rawToken: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashRefreshToken(rawToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
