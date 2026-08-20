/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  SAVDO TURLARI — YAGONA MANBA                                            ║
 * ║                                                                          ║
 * ║  Platformada uch xil narsa sotiladi:                                     ║
 * ║    • jismoniy tovar   — pochta/kuryer, trek-raqam bilan                  ║
 * ║    • eFootball akkaunt — CHAT orqali topshiriladi                        ║
 * ║    • raqamli mahsulot — PDF, video, mp3, havola yoki matn                ║
 * ║                                                                          ║
 * ║  PUL YO'LI UCHALASIDA BIR XIL: escrow, komissiya, ledger, nizo —        ║
 * ║  hammasi o'zgarmaydi. Farq faqat uch narsada:                           ║
 * ║    1. sotuvchi nimani topshiradi                                        ║
 * ║    2. xaridorga tasdiqlashga qancha vaqt beriladi                       ║
 * ║    3. interfeys matnlari                                                ║
 * ║                                                                          ║
 * ║  Yangi tur qo'shish yoki muddatni o'zgartirish = SHU FAYLDAGI bitta      ║
 * ║  qiymatni almashtirish.                                                 ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

/** `deals.deal_type` ustuni shu qiymatlarni oladi. */
export const DEAL_TYPES = ['PHYSICAL', 'GAME_ACCOUNT', 'DIGITAL'] as const;
export type DealType = (typeof DEAL_TYPES)[number];

/**
 * Sotuvchi tovarni qanday topshiradi.
 *
 * `tracking`  — yetkazuvchi nomi + trek-raqam (ochiq saqlanadi)
 * `chat`      — sotuvchi va xaridor yozishadi, akkaunt shu yerda o'tkaziladi
 * `content`   — havola, matn yoki fayl (shifrlangan holda saqlanadi)
 */
export type HandoverKind = 'tracking' | 'chat' | 'content';

export interface DealTypeRule {
  readonly id: DealType;
  /** Savdo yaratish sahifasidagi tugma matni. */
  readonly label: string;
  /** Tugma ostidagi bir qatorlik izoh. */
  readonly hint: string;
  readonly handover: HandoverKind;

  /**
   * Sotuvchi topshirgandan keyin xaridorga TASDIQLASH uchun beriladigan vaqt.
   * Vaqt tugasa pul avtomatik sotuvchiga o'tadi (nizo ochilmagan bo'lsa).
   */
  readonly autoReleaseHours: number;

  /**
   * Pul kelgandan keyin sotuvchiga "topshirishni unutdingiz" eslatmasi
   * necha soatdan so'ng yuboriladi.
   */
  readonly handoverReminderHours: number;

  /**
   * Xaridorga "pul avtomatik o'tib ketadi" ogohlantirishi auto-release'dan
   * necha soat OLDIN yuboriladi.
   *
   * `0` = eslatma yuborilmaydi. Raqamli mahsulotda muddat 1 soat — xat
   * yetib borguncha vaqt tugaydi, shuning uchun eslatmadan foyda yo'q.
   * Uning o'rniga muddat to'lov sahifasida KATTA qilib ko'rsatiladi.
   */
  readonly confirmReminderHours: number;

  /** Interfeys matnlari — savdo turiga qarab o'zgaradi. */
  readonly text: {
    /** Savdo predmetining nomi. */
    readonly itemLabel: string;
    readonly itemPlaceholder: string;
    /** Sotuvchi bosadigan tugma. */
    readonly handoverAction: string;
    /** Xaridor bosadigan tasdiqlash tugmasi. */
    readonly confirmAction: string;
    /** Progress qadamining nomi. */
    readonly handoverStep: string;
  };
}

export const DEAL_TYPE_RULES: Readonly<Record<DealType, DealTypeRule>> = {
  PHYSICAL: {
    id: 'PHYSICAL',
    label: 'Jismoniy tovar',
    hint: 'Telefon, kiyim, texnika — pochta yoki kuryer orqali',
    handover: 'tracking',
    autoReleaseHours: 7 * 24,
    handoverReminderHours: 3 * 24,
    confirmReminderHours: 3 * 24,
    text: {
      itemLabel: 'Tovar nomi',
      itemPlaceholder: 'Masalan: iPhone 14 Pro, 256GB',
      handoverAction: 'Yuborildi — trek-raqam kiritish',
      confirmAction: 'Oldim, hammasi joyida',
      handoverStep: 'Yuborildi',
    },
  },

  GAME_ACCOUNT: {
    id: 'GAME_ACCOUNT',
    label: 'eFootball akkaunt',
    hint: 'Chat ochiladi — akkauntni o\'sha yerda o\'tkazasiz',
    handover: 'chat',
    autoReleaseHours: 3 * 24,
    handoverReminderHours: 12,
    confirmReminderHours: 24,
    text: {
      itemLabel: 'Akkaunt nomi',
      itemPlaceholder: 'Masalan: eFootball — 3500 GP, Legend o\'yinchilar',
      handoverAction: 'Akkauntni topshirdim',
      confirmAction: 'Akkaunt nomimga o\'tdi',
      handoverStep: 'Topshirildi',
    },
  },

  DIGITAL: {
    id: 'DIGITAL',
    label: 'Raqamli mahsulot',
    hint: 'PDF, video, mp3, havola yoki matn',
    handover: 'content',
    /**
     * 1 SOAT — xaridor to'lagach faylni tekshirishga shuncha vaqt oladi.
     * Vaqt tugasa pul avtomatik sotuvchiga o'tadi.
     *
     * ⚠️ Bu ataylab qisqa: raqamli mahsulot bir zumda yetkaziladi va
     * sotuvchini uzoq kuttirishning ma'nosi yo'q. Lekin xaridor uchun
     * xavfli — shuning uchun muddat to'lov sahifasida va xatda KATTA
     * qilib ko'rsatiladi.
     */
    autoReleaseHours: 1,
    handoverReminderHours: 6,
    confirmReminderHours: 0, // eslatma yuborilmaydi — muddat juda qisqa
    text: {
      itemLabel: 'Mahsulot nomi',
      itemPlaceholder: 'Masalan: "Ingliz tili 100 dars" video kursi',
      handoverAction: 'Mahsulotni topshirish',
      confirmAction: 'Mahsulotni tekshirdim',
      handoverStep: 'Topshirildi',
    },
  },
} as const;

/** Noma'lum qiymat kelsa jismoniy tovar deb qaraladi — eng uzun muddat. */
export function dealTypeRule(type: DealType | string | null | undefined): DealTypeRule {
  const rule = DEAL_TYPE_RULES[type as DealType];
  return rule ?? DEAL_TYPE_RULES.PHYSICAL;
}

export function isDealType(value: unknown): value is DealType {
  return typeof value === 'string' && (DEAL_TYPES as readonly string[]).includes(value);
}

/** Shu savdoda sotuvchi maxfiy ma'lumot (havola/matn/fayl) topshiradimi. */
export function usesContent(type: DealType | string | null | undefined): boolean {
  return dealTypeRule(type).handover === 'content';
}

/** Shu savdoda topshirish CHAT orqali bo'ladimi. */
export function usesChat(type: DealType | string | null | undefined): boolean {
  return dealTypeRule(type).handover === 'chat';
}

// ─────────────────────────────────────────────────────────────────────────────
// KALIT SO'Z — SAVDONI TOPISH USULI
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sotuvchi savdo yaratganda KALIT SO'Z o'ylab topadi. Xaridor o'sha kalit
 * so'zni kiritib savdoni topadi va to'laydi.
 *
 * Nega email emas:
 *   • sotuvchi xaridorning emailini oldindan bilmasligi mumkin
 *   • kalit so'zni Telegram/Instagram orqali tarqatish oson
 *   • xaridordan ortiqcha ma'lumot so'ralmaydi
 *
 * Kalit so'z NOYOB bo'lishi shart: ikkita ochiq savdo bir xil kalit so'zga
 * ega bo'lsa, xaridor qaysi biriga to'layotganini bilmasdi.
 */
export const KEYWORD_RULES = {
  minLength: 4,
  maxLength: 32,
  /**
   * Faqat lotin harflari, raqam, tire va pastki chiziq.
   *
   * Bo'sh joy va maxsus belgilar YO'Q: kalit so'z og'zaki aytiladi va
   * xabarga yoziladi — "Salom Dunyo!" ni to'g'ri qayta yozish qiyin.
   */
  pattern: /^[a-zA-Z0-9_-]+$/,
  patternHint: 'Faqat lotin harflari, raqamlar, tire va pastki chiziq',
} as const;

/** Kalit so'zni tekshiradi. Xato bo'lsa sababini qaytaradi. */
export function validateKeyword(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const value = raw.trim();

  if (value.length < KEYWORD_RULES.minLength) {
    return { ok: false, error: `Kalit so'z kamida ${KEYWORD_RULES.minLength} belgi bo'lishi kerak` };
  }
  if (value.length > KEYWORD_RULES.maxLength) {
    return { ok: false, error: `Kalit so'z ${KEYWORD_RULES.maxLength} belgidan oshmasligi kerak` };
  }
  if (!KEYWORD_RULES.pattern.test(value)) {
    return { ok: false, error: KEYWORD_RULES.patternHint };
  }
  return { ok: true, value };
}

/**
 * Kalit so'zni qidirish uchun normallashtiradi.
 *
 * Katta-kichik harf farq qilmaydi: xaridor "MyShop1" deb yozsa ham,
 * "myshop1" deb yozsa ham bir xil savdoni topadi. Aks holda savdo
 * "topilmadi" bo'lib, xaridor sababini tushunmasdi.
 */
export function normalizeKeyword(raw: string): string {
  return raw.trim().toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// HAMYON — 30 SOATLIK MUZLATISH
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Savdo yakunlangach pul darhol yechib olinmaydi — 30 soat MUZLATILADI.
 *
 * Nega kerak:
 *   • to'lov tizimi to'lovni qaytarib olishi mumkin (chargeback)
 *   • firibgar sotuvchi soxta savdo qilib pulni darhol yechib ketolmaydi
 *   • xaridor "aldadi" desa, pul hali platformada — qaytarish oson
 *
 * Bu muddat ichida pul foydalanuvchi hisobida ko'rinadi, lekin
 * "muzlatilgan" deb belgilanadi va yechib bo'lmaydi.
 */
export const WALLET_HOLD_HOURS = 30;

// ─────────────────────────────────────────────────────────────────────────────
// RAQAMLI MAHSULOT
// ─────────────────────────────────────────────────────────────────────────────

/** Sotuvchi nima topshirayotgani. */
export const CONTENT_KINDS = ['link', 'text', 'file'] as const;
export type ContentKind = (typeof CONTENT_KINDS)[number];

export const CONTENT_KIND_LABELS: Readonly<Record<ContentKind, string>> = {
  link: 'Havola',
  text: 'Matn',
  file: 'Fayl',
};

/**
 * Yuklash mumkin bo'lgan fayl turlari.
 *
 * Ro'yxat ATAYLAB qisqa: har bir tur uchun MIME faylning ICHIDAN
 * tekshiriladi (kengaytmadan emas), ya'ni `.pdf` deb nomlangan
 * bajariladigan fayl o'tmaydi.
 */
export const ALLOWED_CONTENT_TYPES: Readonly<Record<string, string>> = {
  'application/pdf': 'pdf',
  'video/mp4': 'mp4',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'application/zip': 'zip',
};

/** Bitta faylning eng katta hajmi (bayt). 200 MB. */
export const MAX_CONTENT_FILE_BYTES = 200 * 1024 * 1024;

/**
 * Xaridorga beriladigan yuklab olish havolasining amal qilish muddati
 * (soniya). 1 soat — auto-release muddati bilan bir xil.
 */
export const DOWNLOAD_URL_TTL_SECONDS = 60 * 60;

// ─────────────────────────────────────────────────────────────────────────────
// XAVFSIZLIK MATNLARI
// ─────────────────────────────────────────────────────────────────────────────

/** XARIDOR uchun ro'yxat — eFootball akkaunt tasdiqlashdan OLDIN. */
export const BUYER_ACCOUNT_CHECKLIST: readonly string[] = [
  'Akkauntga kirdim va ichidagi hamma narsa savdoda yozilganidek',
  'Parolni O\'ZIMNIKIGA almashtirdim',
  'Bog\'langan pochtani (va telefonni) o\'zimnikiga almashtirdim',
  'Ikki bosqichli himoyani yoqdim (agar o\'yinda bo\'lsa)',
];

/** SOTUVCHI uchun ogohlantirish. */
export const SELLER_ACCOUNT_WARNING =
  'Akkauntni topshirgandan keyin uni qaytarib olishga urinmang: parol tiklash ' +
  'so\'rovi yuborsangiz nizo avtomatik xaridor foydasiga hal qilinadi va pul ' +
  'unga qaytariladi.';

/**
 * Xaridor akkaunt/mahsulot ma'lumotlarini KO'RA OLADIGAN holatlar.
 *
 * `REFUNDED` va `RESOLVED_BUYER` ro'yxatda YO'Q: bu holatlarda pul xaridorga
 * qaytgan, ya'ni u mahsulotga haqli emas.
 */
export const CREDENTIALS_VISIBLE_STATUSES = [
  'SHIPPED',
  'DELIVERED',
  'AUTO_RELEASED',
  'DISPUTED',
  'RESOLVED_SELLER',
  'RESOLVED_SPLIT',
] as const;

export function credentialsVisibleIn(status: string): boolean {
  return (CREDENTIALS_VISIBLE_STATUSES as readonly string[]).includes(status);
}

/**
 * Chat ochiq bo'ladigan holatlar.
 *
 * To'lovdan OLDIN chat yo'q: aks holda tomonlar platformadan tashqarida
 * kelishib, komissiyasiz savdo qilib ketishardi. Nizo paytida chat
 * OCHIQ qoladi — yozishmalar arbitr uchun dalil.
 */
export const CHAT_OPEN_STATUSES = [
  'FUNDED',
  'SHIPPED',
  'DISPUTED',
] as const;

export function chatOpenIn(status: string): boolean {
  return (CHAT_OPEN_STATUSES as readonly string[]).includes(status);
}
