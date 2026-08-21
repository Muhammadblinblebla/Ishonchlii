/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  QATTIQ TEKSHIRUV YOQILGANINI KAFOLATLAYDI                               ║
 * ║                                                                          ║
 * ║  Bu fayl hech qanday ish bajarmaydi. Uning yagona vazifasi —             ║
 * ║  `strictNullChecks` o'chirilgan bo'lsa BUILD'NI YIQITISH.                ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * NEGA KERAK — HAQIQIY HODISA
 *
 * Vercel `apps/api` ni bizning `tsconfig.base.json` SIZ kompilyatsiya
 * qildi va `strict` o'chib qoldi. Oqibati shunchaki "biroz bo'shroq
 * tekshiruv" emas edi:
 *
 *   `strictNullChecks` o'chganda `undefined extends string` ROST bo'ladi.
 *   Zod aynan shu shart orqali qaysi maydon majburiy ekanini aniqlaydi.
 *   Ya'ni zod BARCHA maydonlarni "ixtiyoriy" deb hisoblab qo'yadi.
 *
 * Natijada `{ title: string }` kutilgan joyga `{ title?: string }` o'tadi
 * va TypeScript buni to'sib qololmaydi. Amalda bu shuni anglatadi:
 * `undefined` qiymat `string` deb belgilangan joyga kirib boradi —
 * masalan savdo summasi yoki kalit so'z bo'sh holda xizmat qatlamiga
 * yetib boradi.
 *
 * Bunday sozlama bilan qurilgan server ISHGA TUSHMASLIGI kerak.
 *
 * QANDAY ISHLAYDI
 *
 * `strictNullChecks` YOQILGAN bo'lsa: `undefined extends string` — YOLG'ON,
 * demak `StrictModeRequired` = `true` va quyidagi o'zlashtirish o'tadi.
 *
 * O'CHIRILGAN bo'lsa: shart ROST bo'lib, tip `never` ga aylanadi va
 * kompilyator shu yerda to'xtaydi.
 */

type StrictModeRequired = undefined extends string
  ? 'XATO: strictNullChecks o\'chirilgan — tsconfig.base.json qo\'llanmagan'
  : true;

/**
 * Xato bo'lsa kompilyator shu qatorni ko'rsatadi. Yuqoridagi tip nomi
 * va matni xato xabarida chiqadi — ya'ni sabab darhol o'qiladi.
 */
export const STRICT_MODE_ON: StrictModeRequired = true;
