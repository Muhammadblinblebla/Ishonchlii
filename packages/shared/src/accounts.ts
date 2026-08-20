/**
 * Ledger hisoblarining nomlanishi.
 *
 * Hisob ID'si — matn. Uni qo'lda yozish TAQIQLANADI, faqat shu yerdagi
 * funksiyalar orqali quriladi. Sababi: bitta xato harf (`avaliable`) pulni
 * mavjud bo'lmagan hisobga yozib yuboradi va SUM() baribir 0 chiqadi —
 * ya'ni xato jimgina o'tib ketadi.
 */

export const ACCOUNT_KINDS = [
  /** Foydalanuvchi yechib olishi mumkin bo'lgan mablag'. */
  'user_available',
  /** Foydalanuvchining muzlatilgan (savdo tugamagan) mablag'i. */
  'user_pending',
  /** Savdo yakunlangan, lekin 30 soatlik ushlab turish muddati tugamagan. */
  'user_holding',
  /** Escrowda turgan umumiy pul — platforma aktivi. */
  'platform_escrow',
  /** Escrow aktiviga qarshi turuvchi majburiyat. */
  'platform_escrow_liability',
  /** Komissiya daromadi. */
  'platform_revenue',
  /** Tashqi dunyo: to'lov provayderidan kirgan / unga qaytgan pul. */
  'external',
  /** To'lov tizimi ushlab qolgan komissiya. */
  'provider_fee_expense',
] as const;

export type AccountKind = (typeof ACCOUNT_KINDS)[number];

/** Yechib olish mumkin bo'lgan balans. */
export function userAvailable(userId: string): string {
  return `user:${userId}:available`;
}

/** Muzlatilgan balans (savdo hali yakunlanmagan). */
export function userPending(userId: string): string {
  return `user:${userId}:pending`;
}

/**
 * Savdo yakunlandi, lekin pul hali yechib olinmaydi.
 *
 * `pending` dan farqi: `pending` — savdo DAVOM ETAYOTGANI uchun muzlatilgan
 * (natija noma'lum). `holding` — savdo YAKUNLANDI, pul sotuvchiniki, lekin
 * 30 soatlik xavfsizlik muddati o'tmagan.
 *
 * Ikkalasini ajratish kerak: birinchisida pul hali sotuvchiniki emas,
 * ikkinchisida esa uniki — faqat vaqti kelmagan. Nizo va qaytarishda
 * bu farq muhim.
 */
export function userHolding(userId: string): string {
  return `user:${userId}:holding`;
}

/** Escrowdagi umumiy pul (platforma aktivi). */
export const PLATFORM_ESCROW = 'platform:escrow';

/**
 * Escrow aktiviga qarshi majburiyat.
 *
 * Nega kerak: pul kirganda uni bir vaqtning o'zida ikki tomondan yozamiz —
 * platforma aktivi (`platform:escrow`) va sotuvchining shartli da'vosi
 * (`user:{id}:pending`). Ikkalasi ham musbat bo'lgani uchun yig'indini 0 da
 * ushlash uchun qarshi hisob kerak. Shunda `/wallet` dagi "muzlatilgan"
 * summa ham, umumiy escrow ham ledgerdan to'g'ridan-to'g'ri SUM() bilan chiqadi.
 */
export const PLATFORM_ESCROW_LIABILITY = 'platform:escrow_liability';

/** Komissiya daromadi. */
export const PLATFORM_REVENUE = 'platform:revenue';

/**
 * To'lov tizimiga ketgan komissiya.
 *
 * Bu pul bizga hech qachon tushmaydi — provayder uni to'lov paytida
 * ushlab qoladi. Alohida hisobda saqlanadi, chunki:
 *   • escrowda bo'lmagan pul bordek ko'rinmasligi kerak
 *   • qancha to'lov komissiyasiga ketganini bilish kerak
 */
export const PROVIDER_FEE_EXPENSE = 'expense:payment_provider';

/** To'lov provayderidan kirgan pul (tashqi dunyo). */
export function externalProvider(provider: string): string {
  return `external:${provider}`;
}

/** Foydalanuvchiga tashqariga chiqarilgan pul (payout). */
export function externalPayout(provider: string): string {
  return `external:${provider}:payout`;
}

/** Xaridorga qaytarilgan pul (refund). */
export function externalRefund(provider: string): string {
  return `external:${provider}:refund`;
}

export type UserAccountKind = 'available' | 'pending' | 'holding';

const USER_ACCOUNT_RE = /^user:([0-9a-zA-Z_-]+):(available|pending|holding)$/;

/** Hisob ID'sidan foydalanuvchi ID'sini ajratib oladi. Foydalanuvchi hisobi bo'lmasa `null`. */
export function parseUserAccount(
  accountId: string,
): { userId: string; kind: UserAccountKind } | null {
  const m = USER_ACCOUNT_RE.exec(accountId);
  if (!m) return null;
  const [, userId, kind] = m;
  if (userId === undefined || kind === undefined) return null;
  return { userId, kind: kind as UserAccountKind };
}
