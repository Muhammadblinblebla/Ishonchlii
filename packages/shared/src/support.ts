/**
 * QO'LLAB-QUVVATLASH — sozlamalar va matnlar.
 *
 * Backend ham, frontend ham shu yerdan o'qiydi: rasm chegarasi ikki
 * joyda alohida yozilsa, brauzer qabul qilgan faylni server rad etib,
 * foydalanuvchi sababini tushunmasdi.
 */

/**
 * Rasmning eng katta hajmi (bayt) — SIQILGANDAN KEYIN.
 *
 * Brauzer rasmni yuborishdan oldin siqadi (eni 1600px, JPEG 80%).
 * Oddiy telefon skrinshoti shundan keyin ~150–400 KB bo'ladi, ya'ni
 * 2 MB chegarasi keng zapas.
 *
 * Nega umuman cheklov: rasmlar Postgres ichida saqlanadi va Supabase
 * bepul tarifi 500 MB. Cheklovsiz yuklash bazani to'ldirib qo'yardi.
 */
export const SUPPORT_MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/**
 * Rasmli so'rovning eng katta tanasi (bayt).
 *
 * base64 kodlash hajmni ~33% oshiradi, ustiga JSON qobig'i. Shuning
 * uchun rasm chegarasidan ANCHA katta olinadi — aks holda ruxsat
 * etilgan rasm ham "413" bilan qaytardi.
 */
export const SUPPORT_REQUEST_BODY_LIMIT = 4 * 1024 * 1024;

/** Qabul qilinadigan rasm turlari. */
export const SUPPORT_ALLOWED_IMAGE_MIMES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

/** Brauzerda siqishda ishlatiladigan eng katta o'lcham (piksel). */
export const SUPPORT_IMAGE_MAX_DIMENSION = 1600;
/** JPEG sifati (0–1). 0.8 — ko'z ilg'amaydigan yo'qotish, hajm 4-5 barobar kam. */
export const SUPPORT_IMAGE_QUALITY = 0.8;

/**
 * Tayyor mavzular.
 *
 * Foydalanuvchi bo'sh maydonga qarab "nima yozsam?" deb o'ylanib
 * qolmasin — eng ko'p uchraydigan sabablar ro'yxatdan tanlanadi.
 * Admin uchun ham foydali: murojaatlar turkumlangan bo'ladi.
 */
export const supportSubjects = [
  'To\'lov qilolmayapman',
  'Pul yechib ololmayapman',
  'Sotuvchi mahsulotni topshirmadi',
  'Mahsulot tavsifga mos kelmadi',
  'Akkaunt qaytarib olindi',
  'Kalit so\'z ishlamayapti',
  'Hisobimga kira olmayapman',
  'Boshqa savol',
] as const;

/** Murojaat holatlarining ko'rinadigan nomlari. */
export const supportStatusLabels: Readonly<Record<string, string>> = {
  open: 'Javob kutilmoqda',
  answered: 'Javob berildi',
  closed: 'Yopilgan',
};
