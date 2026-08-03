/**
 * Barcha interfeys matnlari (§10).
 *
 * Kodga matn qattiq yozilmaydi — hammasi shu yerda. Sababi: matnni
 * o'zgartirish uchun komponentlarni qidirib yurish kerak emas, va
 * keyinchalik boshqa tilga o'girish oson.
 */

import type { DealStatus } from '../deal-status.js';

export const uz = {
  common: {
    appName: 'Escrow.uz',
    tagline: 'Xavfsiz savdo — pul faqat tovar yetib borgach o\'tadi',
    loading: 'Yuklanmoqda…',
    save: 'Saqlash',
    cancel: 'Bekor qilish',
    back: 'Orqaga',
    next: 'Keyingisi',
    close: 'Yopish',
    confirm: 'Tasdiqlash',
    error: 'Xatolik yuz berdi',
    retry: 'Qayta urinish',
    copy: 'Nusxa olish',
    copied: 'Nusxa olindi',
    soum: 'so\'m',
    you: 'Siz',
    empty: 'Hozircha bo\'sh',
  },

  nav: {
    home: 'Bosh sahifa',
    dashboard: 'Savdolarim',
    newDeal: 'Yangi savdo',
    wallet: 'Hamyon',
    admin: 'Nizolar',
    login: 'Kirish',
    register: 'Ro\'yxatdan o\'tish',
    logout: 'Chiqish',
  },

  landing: {
    heroTitle: 'Notanish odam bilan xavfsiz savdo qiling',
    heroSubtitle:
      'Pul platformada muzlatib turiladi. Sotuvchi tovarni yuboradi, siz olganingizni tasdiqlaysiz — va shundagina pul unga o\'tadi.',
    ctaPrimary: 'Bepul boshlash',
    ctaSecondary: 'Qanday ishlaydi',
    howItWorks: 'Uch qadamda',
    step1Title: 'Kelishuv',
    step1Text: 'Sotuvchi savdo yaratadi: tovar, narx, shartlar. Xaridor ko\'rib chiqib qabul qiladi.',
    step2Title: 'To\'lov muzlatiladi',
    step2Text:
      'Xaridor pulni platformaga tushiradi. Pul sotuvchiga O\'TMAYDI — u xavfsiz saqlanadi.',
    step3Title: 'Tasdiq va to\'lov',
    step3Text:
      'Tovar yetib borgach xaridor tasdiqlaydi. Shundan keyingina pul sotuvchiga o\'tkaziladi.',
    safetyTitle: 'Nima uchun xavfsiz',
    safety1: 'Pul har ikki tomon uchun ham himoyalangan',
    safety2: 'Nizo chiqsa — mustaqil arbitr ko\'rib chiqadi',
    safety3: 'Har bir amal o\'zgarmas tarixga yoziladi',
  },

  auth: {
    loginTitle: 'Hisobingizga kiring',
    registerTitle: 'Yangi hisob yarating',
    email: 'Email',
    password: 'Parol',
    passwordHint: 'Kamida 8 belgi',
    fullName: 'To\'liq ism',
    phone: 'Telefon (ixtiyoriy)',
    phonePlaceholder: '+998901234567',
    loginButton: 'Kirish',
    registerButton: 'Ro\'yxatdan o\'tish',
    noAccount: 'Hisobingiz yo\'qmi?',
    haveAccount: 'Hisobingiz bormi?',
    invalidCredentials: 'Email yoki parol noto\'g\'ri',
  },

  deal: {
    title: 'Savdo',
    itemTitle: 'Tovar nomi',
    description: 'Tavsif',
    amount: 'Narxi',
    commission: 'Komissiya',
    commissionPayer: 'Komissiyani kim to\'laydi',
    payerBuyer: 'Xaridor',
    payerSeller: 'Sotuvchi',
    payerSplit: 'Teng bo\'linadi',
    buyerPays: 'Xaridor to\'laydi',
    sellerReceives: 'Sotuvchi oladi',
    counterparty: 'Qarshi tomon emaili',
    myRoleBuyer: 'Men xaridorman',
    myRoleSeller: 'Men sotuvchiman',
    buyer: 'Xaridor',
    seller: 'Sotuvchi',
    createdAt: 'Yaratilgan',
    history: 'Voqealar tarixi',
    tracking: 'Trek-raqam',
    carrier: 'Yetkazuvchi',

    createTitle: 'Yangi savdo yaratish',
    createButton: 'Savdo yaratish',
    createHint: 'Qarshi tomon platformada ro\'yxatdan o\'tgan bo\'lishi kerak',

    // Qadamlar (§10)
    stepAgreement: 'Kelishuv',
    stepPayment: 'To\'lov',
    stepShipped: 'Yuborildi',
    stepConfirmed: 'Tasdiqlandi',

    // Amallar
    accept: 'Shartlarni qabul qilaman',
    pay: 'To\'lov qilish',
    ship: 'Yuborildi — trek-raqam kiritish',
    confirm: 'Oldim, hammasi joyida',
    cancel: 'Savdoni bekor qilish',
    dispute: 'Nizo ochish',

    confirmDialogTitle: 'Tasdiqlashni xohlaysizmi?',
    confirmDialogText:
      'Bu amalni ortga qaytarib bo\'lmaydi. Tovarni ko\'rdingizmi va hammasi joyidami?',
    confirmDialogAction: 'Ha, pulni o\'tkazing',

    disputeTitle: 'Nizo ochish',
    disputeReason: 'Nima bo\'ldi? Batafsil yozing',
    disputeHint: 'Nizo ochilgach pul muzlatilgan holda qoladi va admin ko\'rib chiqadi',
    disputeButton: 'Nizoni ochish',

    tabActive: 'Faol',
    tabCompleted: 'Tugagan',
    tabDisputed: 'Nizoli',
    noDeals: 'Hozircha savdolaringiz yo\'q',
    noDealsHint: 'Birinchi savdoni yarating va xavfsiz savdo qilishni boshlang',
  },

  wallet: {
    title: 'Hamyon',
    available: 'Yechib olish mumkin',
    pending: 'Muzlatilgan',
    pendingHint: 'Savdolar yakunlangach bu summa yechib olinadi',
    total: 'Jami',
    payout: 'Pul yechish',
    payoutAmount: 'Summa',
    payoutDestination: 'Karta raqami',
    payoutButton: 'Yechishni so\'rash',
    transactions: 'Tranzaksiyalar',
    noTransactions: 'Hozircha tranzaksiyalar yo\'q',
    insufficientFunds: 'Mablag\' yetarli emas',
  },

  admin: {
    title: 'Nizolar',
    openDisputes: 'Ochiq nizolar',
    noDisputes: 'Hal qilinmagan nizolar yo\'q',
    resolveTitle: 'Nizoni hal qilish',
    resolveBuyer: 'Xaridor foydasiga',
    resolveSeller: 'Sotuvchi foydasiga',
    resolveSplit: 'Bo\'lib berish',
    buyerShare: 'Xaridor ulushi (%)',
    resolutionNote: 'Qaror sababi (ikkala tomon ko\'radi)',
    resolveButton: 'Qarorni tasdiqlash',
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// HOLAT NOMLARI VA TUSHUNTIRISHLARI
// ─────────────────────────────────────────────────────────────────────────────

export const statusLabels: Record<DealStatus, string> = {
  DRAFT: 'Kelishuv kutilmoqda',
  AWAITING_PAYMENT: 'To\'lov kutilmoqda',
  FUNDED: 'Pul muzlatildi',
  SHIPPED: 'Yuborildi',
  DELIVERED: 'Yakunlandi',
  AUTO_RELEASED: 'Avtomatik yakunlandi',
  DISPUTED: 'Nizo',
  RESOLVED_BUYER: 'Xaridor foydasiga hal qilindi',
  RESOLVED_SELLER: 'Sotuvchi foydasiga hal qilindi',
  RESOLVED_SPLIT: 'Bo\'lib berildi',
  REFUNDED: 'Qaytarildi',
  CANCELLED: 'Bekor qilindi',
  EXPIRED: 'Muddati o\'tdi',
  PAYMENT_MISMATCH: 'To\'lov tekshirilmoqda',
};

/**
 * "Hozir kim nima qilishi kerak" (§10).
 *
 * Savdo sahifasidagi eng muhim blok — foydalanuvchi sahifani ochganda
 * birinchi shuni o'qiydi.
 */
export function whatHappensNow(
  status: DealStatus,
  role: 'buyer' | 'seller' | 'admin',
): { title: string; text: string } {
  const isBuyer = role === 'buyer';

  switch (status) {
    case 'DRAFT':
      return isBuyer
        ? {
            title: 'Shartlarni ko\'rib chiqing',
            text: 'Tovar, narx va shartlar sizga to\'g\'ri kelsa — qabul qiling. Shundan keyin to\'lov qilasiz.',
          }
        : {
            title: 'Xaridor javobini kutmoqdamiz',
            text: 'Xaridor shartlarni qabul qilishi kerak. Havolani unga yuboring.',
          };

    case 'AWAITING_PAYMENT':
      return isBuyer
        ? {
            title: 'To\'lov qilish vaqti',
            text: 'Pul platformada muzlatib turiladi. Sotuvchi uni siz tasdiqlamaguningizcha ololmaydi.',
          }
        : {
            title: 'To\'lov kutilmoqda',
            text: 'Xaridor to\'lovni amalga oshirishi kerak. To\'lov kelgach sizga xabar beriladi.',
          };

    case 'FUNDED':
      return isBuyer
        ? {
            title: 'Pul xavfsiz saqlanmoqda',
            text: 'Sotuvchi tovarni yuborishi kerak. U trek-raqam kiritgach sizga xabar beramiz.',
          }
        : {
            title: 'Tovarni yuboring',
            text: 'Pul platformada. Tovarni yuboring va trek-raqamni kiriting.',
          };

    case 'SHIPPED':
      return isBuyer
        ? {
            title: 'Tovarni kuting va tasdiqlang',
            text: 'Tovar yetib borgach tekshiring. Hammasi joyida bo\'lsa tasdiqlang, muammo bo\'lsa nizo oching.',
          }
        : {
            title: 'Xaridor tasdiqini kutmoqdamiz',
            text: 'Tovar yetib borgach xaridor tasdiqlaydi va pul sizga o\'tadi.',
          };

    case 'DISPUTED':
      return {
        title: 'Nizo ko\'rib chiqilmoqda',
        text: 'Pul muzlatilgan holda qoldi. Dalillaringizni yuklang — admin ikkala tomonni tinglab qaror qabul qiladi.',
      };

    case 'PAYMENT_MISMATCH':
      return {
        title: 'To\'lov tekshirilmoqda',
        text: 'Kelgan summa savdodagidan farq qildi. Administrator qo\'lda tekshirmoqda, tez orada javob beramiz.',
      };

    case 'DELIVERED':
    case 'AUTO_RELEASED':
      return isBuyer
        ? { title: 'Savdo yakunlandi', text: 'Pul sotuvchiga o\'tkazildi. Savdo muvaffaqiyatli tugadi.' }
        : { title: 'Savdo yakunlandi', text: 'Pul hamyoningizga o\'tkazildi. Uni yechib olishingiz mumkin.' };

    case 'REFUNDED':
    case 'RESOLVED_BUYER':
      return { title: 'Pul qaytarildi', text: 'Summa xaridor hamyoniga qaytarildi.' };

    case 'RESOLVED_SELLER':
      return { title: 'Sotuvchi foydasiga hal qilindi', text: 'Pul sotuvchiga o\'tkazildi.' };

    case 'RESOLVED_SPLIT':
      return { title: 'Bo\'lib berildi', text: 'Admin belgilagan nisbatda taqsimlandi.' };

    case 'CANCELLED':
      return { title: 'Bekor qilindi', text: 'Savdo bekor qilindi. Pul tushmagan edi.' };

    case 'EXPIRED':
      return { title: 'Muddati o\'tdi', text: 'To\'lov belgilangan muddatda amalga oshirilmadi.' };
  }
}

/** `SHIPPED` holatidagi taymer matni (§10). */
export function autoReleaseWarning(remainingMs: number): string {
  if (remainingMs <= 0) return 'Vaqt tugadi — pul avtomatik o\'tkazilmoqda.';

  const days = Math.floor(remainingMs / 86_400_000);
  const hours = Math.floor((remainingMs % 86_400_000) / 3_600_000);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days} kun`);
  if (hours > 0 || days === 0) parts.push(`${hours} soat`);

  return `Tasdiqlashingizga ${parts.join(' ')} qoldi. Vaqt tugasa pul avtomatik sotuvchiga o'tadi.`;
}
