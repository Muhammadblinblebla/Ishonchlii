/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  FOYDALANUVCHI KESHI — har so'rovdagi bazaga borishni yo'q qiladi        ║
 * ║                                                                          ║
 * ║  MUAMMO: har bir avtorizatsiyalangan so'rov `users` jadvalidan bitta     ║
 * ║  qator o'qiydi. Baza Tokioda va bitta so'rov ~1 soniya — ya'ni har       ║
 * ║  bosishga ish boshlanmasdan 1 soniya qo'shiladi. Savdo sahifasi 6 ta     ║
 * ║  so'rov qilsa, faqat autentifikatsiyaga 6 soniya ketardi.               ║
 * ║                                                                          ║
 * ║  NIMA UCHUN UMUMAN O'QIYMIZ: token amal qilsa ham, foydalanuvchi        ║
 * ║  o'chirilgan yoki admin huquqi tortib olingan bo'lishi mumkin.          ║
 * ║                                                                          ║
 * ║  YECHIM: qisqa muddatli kesh. Xavfsizlikka ta'siri deyarli yo'q —       ║
 * ║  access token ALLAQACHON 15 daqiqa yashaydi, ya'ni o'chirilgan          ║
 * ║  hisob baribir shuncha vaqt ishlay olardi. Kesh bu oynani atigi         ║
 * ║  30 soniyaga uzaytiradi.                                                ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

export interface CachedUser {
  readonly id: string;
  readonly role: 'user' | 'admin';
}

interface Entry {
  readonly user: CachedUser | null; // `null` = o'chirilgan/mavjud emas
  readonly expiresAt: number;
}

/** Kesh muddati (ms). Token umridan ANCHA qisqa. */
const TTL_MS = 30_000;

/**
 * Keshning eng ko'p hajmi.
 *
 * Chegarasiz Map xotira sizishiga aylanadi: har yangi foydalanuvchi
 * yozuv qo'shadi va ular hech qachon o'chmaydi. Uzoq ishlagan server
 * asta-sekin xotirani yeb qo'yardi.
 */
const MAX_ENTRIES = 10_000;

const cache = new Map<string, Entry>();

export function getCachedUser(userId: string): CachedUser | null | undefined {
  const hit = cache.get(userId);
  if (!hit) return undefined; // keshda yo'q

  if (hit.expiresAt <= Date.now()) {
    cache.delete(userId);
    return undefined;
  }

  return hit.user;
}

export function setCachedUser(userId: string, user: CachedUser | null): void {
  // Chegaraga yetganda eng eski yozuvni chiqaramiz. `Map` qo'shilish
  // tartibini saqlaydi, shuning uchun birinchi kalit — eng eskisi.
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(userId, { user, expiresAt: Date.now() + TTL_MS });
}

/**
 * Keshdan darhol chiqaradi.
 *
 * Chiqish (logout), hisobni o'chirish yoki rol o'zgarishida chaqiriladi —
 * shunda 30 soniya kutilmaydi.
 */
export function invalidateUser(userId: string): void {
  cache.delete(userId);
}

/** Testlar uchun. */
export function clearUserCache(): void {
  cache.clear();
}
