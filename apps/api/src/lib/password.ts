/**
 * Parol hashlash — argon2id (§11).
 *
 * Sozlamalar OWASP tavsiyasiga muvofiq. `memoryCost` ni pasaytirmang:
 * argon2ning butun kuchi xotira talabida — GPU bilan hujum qilishni
 * qimmatga tushiradi.
 */

import argon2 from 'argon2';
import { randomBytes } from 'node:crypto';

const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, OPTIONS);
}

/**
 * Parolni tekshiradi. Hash buzuq bo'lsa ham `false` qaytaradi, `throw` qilmaydi —
 * shunda buzuq yozuv 500 xatoga aylanib, hujumchiga signal bermaydi.
 */
export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

/**
 * Mavjud bo'lmagan foydalanuvchi uchun "soxta" tekshiruv.
 *
 * Busiz login javob vaqti oshkor qiladi: email topilmasa javob darhol keladi,
 * topilsa argon2 hisoblagunicha ~50ms kutiladi. Hujumchi shu farqni o'lchab
 * qaysi emaillar ro'yxatda borligini aniqlab oladi (timing attack).
 *
 * Hash qattiq yozilmaydi, balki ishga tushishda HAQIQATAN generatsiya qilinadi.
 * Yaroqsiz hash `argon2.verify` tomonidan darhol rad etilar edi — ya'ni
 * hisob-kitob bajarilmasdan, himoyaning o'zi ma'nosini yo'qotardi.
 */
let dummyHashPromise: Promise<string> | null = null;

function getDummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword(randomBytes(32).toString('hex'));
  return dummyHashPromise;
}

export async function fakeVerify(plain: string): Promise<void> {
  await verifyPassword(await getDummyHash(), plain);
}
