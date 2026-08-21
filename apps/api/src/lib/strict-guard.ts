/**
 * QATTIQ TEKSHIRUV QOROVULI — API kompilyatsiya birligi uchun.
 *
 * `packages/shared/src/strict-guard.ts` bilan bir xil ish qiladi, lekin
 * u YETARLI EMAS: `tsc -b` shared'ni ALOHIDA loyiha sifatida o'z
 * sozlamasi bilan quradi. Ya'ni faqat `apps/api/tsconfig.json`
 * bo'shashtirilsa, shared'dagi qorovul buni sezmaydi — u o'z
 * loyihasida bemalol o'tib ketaveradi.
 *
 * Vercel'da aynan shunday bo'ldi: `apps/api` ning sozlamasi qayta
 * yozilgan, shared esa tegilmagan.
 *
 * Nima uchun muhimligi va mexanizmi shared'dagi faylda batafsil
 * yozilgan. Qisqasi: `strictNullChecks` o'chsa zod barcha maydonlarni
 * ixtiyoriy deb hisoblaydi va `undefined` qiymatlar `string` deb
 * belgilangan joylarga kirib boradi.
 */

type StrictModeRequired = undefined extends string
  ? 'XATO: apps/api strictNullChecks siz kompilyatsiya qilinmoqda'
  : true;

export const API_STRICT_MODE_ON: StrictModeRequired = true;
