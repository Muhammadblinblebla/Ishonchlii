import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';

/**
 * Prisma client — yagona nusxa.
 *
 * `tsx watch` har o'zgarishda modulni qayta yuklaydi; global'da saqlanmasa
 * har safar yangi ulanish hovuzi ochilib, Supabase ulanish chegarasiga
 * urilib qolamiz.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.isProd ? ['error'] : ['warn', 'error'],
  });

if (!env.isProd) globalForPrisma.prisma = prisma;

/**
 * `BigInt` ni JSON'ga o'girish.
 *
 * Barcha summalar `BigInt` (tiyin), lekin `JSON.stringify` uni tashlab
 * yuboradi. Summalar javobda SATR sifatida qaytariladi — JavaScript'ning
 * `number` turi 2^53 dan katta butun sonni aniq saqlay olmaydi, ya'ni
 * katta summa frontendda jimgina buzilib ketishi mumkin.
 */
export function serializeBigInt<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)),
  ) as T;
}
