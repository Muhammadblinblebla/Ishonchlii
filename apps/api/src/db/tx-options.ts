/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  TRANZAKSIYA MUDDATLARI — YAGONA MANBA                                   ║
 * ║                                                                          ║
 * ║  Har bir `prisma.$transaction` chaqiruvi shu yerdan sozlama oladi.       ║
 * ║  Muddatni chaqiruv joyiga yozib qo'yish TAQIQLANADI — aks holda          ║
 * ║  ularning bir qismi eskirib qoladi va faqat ishlamay qolganda            ║
 * ║  ma'lum bo'ladi.                                                         ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * NEGA STANDART QIYMAT YETMAYDI
 *
 * Prisma standarti: `timeout` 5 s, `maxWait` 2 s. Bu baza ILOVA BILAN
 * BIR JOYDA turgan holatga mo'ljallangan — u yerda bitta so'rov ~1 ms.
 *
 * Bizda baza Supabase'da, `ap-northeast-1` (Tokio) da: bitta oddiy
 * so'rov ~1 SONIYA. Savdo holatini o'zgartirish esa bitta tranzaksiya
 * ichida o'nga yaqin so'rov qiladi (qulflab o'qish, ledger yozuvlari,
 * hodisa yozuvi, xabarnomalar).
 *
 *   10 so'rov × ~1 s  ≈  10 s   →  5 soniyalik standartga SIG'MAYDI
 *
 * Bu faraz emas: testlarda aynan shu xato chiqdi —
 *   "The timeout for this transaction was 20000 ms, however 24600 ms passed"
 *
 * PUL YO'QOLADIMI? YO'Q. Muddat tugasa tranzaksiya BUTUNLAY orqaga
 * qaytadi — yarim bajarilgan pul harakati qolmaydi. Ya'ni bu qoida
 * pulning to'g'riligiga emas, faqat "muvaffaqiyatsiz urinishlar
 * soniga" ta'sir qiladi. Shuning uchun muddatni uzaytirish xavfsiz:
 * u hech qanday pul qoidasini o'zgartirmaydi.
 *
 * ⚠️ BU QIYMATLAR KECHIKISHNING NATIJASI, YECHIMI EMAS.
 *    Baza Frankfurtga (`eu-central-1`) ko'chirilsa so'rov ~0.15 s
 *    bo'ladi va bu qiymatlarni ancha pasaytirish mumkin.
 */

/** Prisma `$transaction` uchun sozlama shakli. */
export interface TxOptions {
  readonly maxWait: number;
  readonly timeout: number;
  readonly isolationLevel?: 'Serializable';
}

/**
 * ⚠️ DIQQAT — BU YERDA FAQAT MUDDAT O'ZGARTIRILADI.
 *
 * Har bir chaqiruv joyi O'ZINING izolyatsiya darajasini saqlab qoladi.
 * Ba'zi joylar `Serializable` ishlatadi, ba'zilari esa standart
 * izolyatsiya + `FOR UPDATE` qator qulfi bilan ishlaydi — bu ataylab
 * tanlangan va ikkalasi ham to'g'ri.
 *
 * Hammasini `Serializable` ga o'tkazish JOZIBALI ko'rinadi, lekin
 * yangi serializatsiya xatolarini (40001) keltirib chiqaradi. Ular
 * hozir hech qayerda qayta urinilmaydi, ya'ni savdo o'rtada uzilardi.
 * Bu pul xatti-harakatiga tegadigan o'zgarish — alohida o'ylab,
 * qayta urinish mexanizmi bilan birga qilinishi kerak.
 */

/**
 * PUL HARAKATI + `Serializable` izolyatsiya.
 *
 * Escrow uchun eng qattiq izolyatsiya: ikkita parallel "tasdiqlash"
 * bir xil savdoni ko'rib, pulni ikki marta o'tkazib yubormasligi kerak.
 */
export const MONEY_TX: TxOptions = {
  // Hovuzdan ulanish kutish. Fon vazifalari va foydalanuvchi so'rovlari
  // bir vaqtda kelganda 2 soniya juda qisqa.
  maxWait: 15_000,
  // Tranzaksiyaning o'zi. Yuqoridagi hisob: ~10 so'rov × 1 s + zaxira.
  timeout: 45_000,
  isolationLevel: 'Serializable',
};

/**
 * PUL HARAKATI, lekin himoya `FOR UPDATE` qator qulfi bilan berilgan.
 *
 * `MONEY_TX` dan farqi FAQAT izolyatsiyada: bu yerda u o'zgartirilmaydi.
 * Muddat bir xil — ish hajmi ham bir xil.
 */
export const LOCKED_TX: TxOptions = {
  maxWait: 15_000,
  timeout: 45_000,
};

/**
 * Pulga TEGMAYDIGAN tranzaksiyalar: xabarnoma yozish, murojaat
 * saqlash, token almashtirish.
 *
 * Ish hajmi kichikroq, shuning uchun muddat ham qisqaroq — lekin
 * Prisma standartidan (5 s) baribir ancha uzun.
 */
export const STANDARD_TX: TxOptions = {
  maxWait: 10_000,
  timeout: 20_000,
};
