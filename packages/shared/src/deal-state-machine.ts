/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  SAVDO HOLATLARI MASHINASI                                               ║
 * ║                                                                          ║
 * ║  Butun tizimning to'g'riligi shu faylga bog'liq.                        ║
 * ║                                                                          ║
 * ║  Qoidalar:                                                               ║
 * ║   • Ruxsat etilgan o'tishlar ANIQ RO'YXAT sifatida yozilgan             ║
 * ║   • Ro'yxatda yo'q o'tish — xato. "Sekin o'tkazib yuborish" YO'Q         ║
 * ║   • Yakuniy holatdan hech qayerga o'tib bo'lmaydi                       ║
 * ║   • Bu fayl SOF: DB yo'q, tarmoq yo'q, `Date.now()` yo'q, side-effect yo'q║
 * ║                                                                          ║
 * ║  Sof bo'lgani uchun ham backend, ham frontend ishlatadi. Lekin frontend  ║
 * ║  buni FAQAT tugmalarni ko'rsatish/yashirish uchun ishlatadi — haqiqiy    ║
 * ║  qaror doim serverda qabul qilinadi.                                    ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

import { type DealStatus, isTerminal } from './deal-status.js';

/** Savdo ustida bajarilishi mumkin bo'lgan amallar. */
export type DealAction =
  | 'accept' // xaridor shartlarni qabul qildi
  | 'pay' // to'lov keldi (webhook tasdiqladi)
  | 'ship' // sotuvchi trek-raqam kiritdi
  | 'confirm' // xaridor "Oldim" bosdi
  | 'cancel' // bekor qilish (pul tushmagan)
  | 'refund' // sotuvchi bekor qildi, pul qaytadi
  | 'expire' // to'lov muddati o'tdi
  | 'auto_release' // 7 kun o'tdi, pul avtomatik sotuvchiga
  | 'dispute' // nizo ochildi
  | 'resolve_buyer' // admin: xaridor foydasiga
  | 'resolve_seller' // admin: sotuvchi foydasiga
  | 'resolve_split' // admin: bo'lish
  | 'flag_mismatch' // webhook summasi mos kelmadi
  | 'mismatch_accept' // admin: summa farqi hal qilindi, savdo davom etadi
  | 'mismatch_refund'; // admin: summa farqi hal bo'lmadi, pul qaytadi

/**
 * Amalni kim bajara oladi.
 *
 * `system` — fon vazifasi yoki webhook. Odam emas.
 * `admin`  — §2: admin FAQAT nizo va to'lov nomuvofiqligiga aralashadi.
 */
export type DealActor = 'buyer' | 'seller' | 'admin' | 'system';

export interface Transition {
  readonly from: DealStatus;
  readonly to: DealStatus;
  readonly action: DealAction;
  /** Shu o'tishni bajarishga haqli tomonlar. */
  readonly actors: readonly DealActor[];
  /** Nima uchun mavjudligi — kod o'qiyotgan odam uchun. */
  readonly note: string;
}

/**
 * RUXSAT ETILGAN O'TISHLARNING TO'LIQ RO'YXATI.
 *
 * Bu yerda yo'q o'tish — mavjud emas. Yangi o'tish qo'shish uchun shu
 * ro'yxatga qator qo'shiladi, boshqa hech qayerga tegilmaydi.
 */
export const TRANSITIONS: readonly Transition[] = [
  // ── DRAFT ──────────────────────────────────────────────────────────────────
  {
    from: 'DRAFT',
    to: 'AWAITING_PAYMENT',
    action: 'accept',
    actors: ['buyer'],
    note: 'Xaridor shartlarni qabul qildi, endi to\'lov kutilmoqda',
  },
  {
    from: 'DRAFT',
    to: 'CANCELLED',
    action: 'cancel',
    actors: ['buyer', 'seller'],
    note: 'Kelishuvgacha bekor qilindi — pul tushmagan, ledgerga yozuv yo\'q',
  },

  // ── AWAITING_PAYMENT ───────────────────────────────────────────────────────
  {
    from: 'AWAITING_PAYMENT',
    to: 'FUNDED',
    action: 'pay',
    actors: ['system'],
    note: 'To\'lov keldi. FAQAT webhook orqali — foydalanuvchi o\'zi bosa olmaydi',
  },
  {
    from: 'AWAITING_PAYMENT',
    to: 'EXPIRED',
    action: 'expire',
    actors: ['system'],
    note: '48 soat ichida to\'lov kelmadi',
  },
  {
    from: 'AWAITING_PAYMENT',
    to: 'CANCELLED',
    action: 'cancel',
    actors: ['buyer', 'seller'],
    note: 'To\'lovdan oldin bekor qilindi',
  },
  {
    from: 'AWAITING_PAYMENT',
    to: 'PAYMENT_MISMATCH',
    action: 'flag_mismatch',
    actors: ['system'],
    note: 'Webhook summasi savdo summasiga mos kelmadi (§5) — admin ko\'radi',
  },

  // ── FUNDED ─────────────────────────────────────────────────────────────────
  {
    from: 'FUNDED',
    to: 'SHIPPED',
    action: 'ship',
    actors: ['seller'],
    note: 'Sotuvchi trek-raqam kiritdi',
  },
  {
    from: 'FUNDED',
    to: 'DISPUTED',
    action: 'dispute',
    actors: ['buyer', 'seller'],
    note: 'Nizo ochildi — pul muzlatilgan holda qoladi, timerlar to\'xtaydi',
  },
  {
    from: 'FUNDED',
    to: 'REFUNDED',
    action: 'refund',
    actors: ['seller'],
    note: 'Sotuvchi bajarolmasligini aytdi — pul xaridorga qaytadi',
  },

  // ── SHIPPED ────────────────────────────────────────────────────────────────
  {
    from: 'SHIPPED',
    to: 'DELIVERED',
    action: 'confirm',
    actors: ['buyer'],
    note: 'Xaridor tovarni oldi va tasdiqladi — pul sotuvchiga o\'tadi',
  },
  {
    from: 'SHIPPED',
    to: 'DISPUTED',
    action: 'dispute',
    actors: ['buyer', 'seller'],
    note: 'Nizo ochildi — auto-release timeri TO\'XTAYDI',
  },
  {
    from: 'SHIPPED',
    to: 'AUTO_RELEASED',
    action: 'auto_release',
    actors: ['system'],
    note: '7 kun ichida na tasdiq, na nizo bo\'ldi — pul avtomatik sotuvchiga',
  },

  // ── DISPUTED ───────────────────────────────────────────────────────────────
  //
  // DIQQAT: bu yerdan `auto_release` ga o'tish YO'Q va bo'lmasligi kerak.
  // Klassik xato aynan shu: nizo ochilgan bo'lsa ham timeout ishlab, pulni
  // sotuvchiga o'tkazib yuborish.
  {
    from: 'DISPUTED',
    to: 'RESOLVED_BUYER',
    action: 'resolve_buyer',
    actors: ['admin'],
    note: 'Admin xaridor foydasiga hal qildi',
  },
  {
    from: 'DISPUTED',
    to: 'RESOLVED_SELLER',
    action: 'resolve_seller',
    actors: ['admin'],
    note: 'Admin sotuvchi foydasiga hal qildi',
  },
  {
    from: 'DISPUTED',
    to: 'RESOLVED_SPLIT',
    action: 'resolve_split',
    actors: ['admin'],
    note: 'Admin belgilagan nisbatda bo\'lindi',
  },

  // ── PAYMENT_MISMATCH ───────────────────────────────────────────────────────
  {
    from: 'PAYMENT_MISMATCH',
    to: 'FUNDED',
    action: 'mismatch_accept',
    actors: ['admin'],
    note: 'Admin summa farqini tekshirib, savdoni davom ettirishga qaror qildi',
  },
  {
    from: 'PAYMENT_MISMATCH',
    to: 'REFUNDED',
    action: 'mismatch_refund',
    actors: ['admin'],
    note: 'Summa farqi hal bo\'lmadi — kelgan pul jo\'natuvchiga qaytariladi',
  },
];

// ─── Tez qidiruv uchun indeks (ishga tushishda bir marta quriladi) ───────────

const BY_FROM = new Map<DealStatus, Transition[]>();
for (const t of TRANSITIONS) {
  const list = BY_FROM.get(t.from);
  if (list) list.push(t);
  else BY_FROM.set(t.from, [t]);
}

// ─── Ommaviy API ─────────────────────────────────────────────────────────────

/** Shu holatdan chiqadigan barcha o'tishlar. */
export function transitionsFrom(status: DealStatus): readonly Transition[] {
  return BY_FROM.get(status) ?? [];
}

/** Shu amal shu holatda mumkinmi (kim bajarayotganidan qat'i nazar). */
export function findTransition(
  from: DealStatus,
  action: DealAction,
): Transition | undefined {
  return transitionsFrom(from).find((t) => t.action === action);
}

export type TransitionCheck =
  | { readonly ok: true; readonly transition: Transition }
  | { readonly ok: false; readonly reason: TransitionFailure };

export type TransitionFailure =
  | { readonly code: 'TERMINAL'; readonly message: string }
  | { readonly code: 'NOT_ALLOWED'; readonly message: string }
  | { readonly code: 'WRONG_ACTOR'; readonly message: string };

/**
 * O'tish mumkinmi — sabab bilan.
 *
 * `throw` qilmaydi: chaqiruvchi natijani tekshirib, o'zi qaror qiladi.
 * API `assertTransition` ishlatadi, frontend esa shu funksiya bilan
 * tugmalarni yoqadi/o'chiradi.
 */
export function checkTransition(
  from: DealStatus,
  action: DealAction,
  actor: DealActor,
): TransitionCheck {
  if (isTerminal(from)) {
    return {
      ok: false,
      reason: {
        code: 'TERMINAL',
        message: `Savdo "${from}" yakuniy holatida — uni o'zgartirib bo'lmaydi`,
      },
    };
  }

  const transition = findTransition(from, action);
  if (!transition) {
    const possible = transitionsFrom(from).map((t) => t.action);
    return {
      ok: false,
      reason: {
        code: 'NOT_ALLOWED',
        message:
          `"${from}" holatida "${action}" amali mumkin emas. ` +
          (possible.length > 0
            ? `Mumkin bo'lgan amallar: ${possible.join(', ')}`
            : 'Bu holatda hech qanday amal mumkin emas'),
      },
    };
  }

  if (!transition.actors.includes(actor)) {
    return {
      ok: false,
      reason: {
        code: 'WRONG_ACTOR',
        message:
          `"${action}" amalini "${actor}" bajara olmaydi. ` +
          `Faqat: ${transition.actors.join(', ')}`,
      },
    };
  }

  return { ok: true, transition };
}

/** `checkTransition` ning qisqa varianti — faqat ha/yo'q. */
export function canTransition(
  from: DealStatus,
  action: DealAction,
  actor: DealActor,
): boolean {
  return checkTransition(from, action, actor).ok;
}

/** O'tish natijasidagi holat. Mumkin bo'lmasa `null`. */
export function nextStatus(
  from: DealStatus,
  action: DealAction,
  actor: DealActor,
): DealStatus | null {
  const result = checkTransition(from, action, actor);
  return result.ok ? result.transition.to : null;
}

/**
 * Shu tomon hozir bajara oladigan amallar.
 * Frontend `/deals/[id]` sahifasida qaysi tugmalarni ko'rsatishni shundan biladi.
 */
export function availableActions(
  status: DealStatus,
  actor: DealActor,
): readonly DealAction[] {
  if (isTerminal(status)) return [];
  return transitionsFrom(status)
    .filter((t) => t.actors.includes(actor))
    .map((t) => t.action);
}

/**
 * Avtomatik (fon vazifasi bajaradigan) o'tishlar.
 *
 * Fon vazifasi ishlashdan oldin shu ro'yxatni tekshiradi: savdo navbatda
 * turgan paytda holati o'zgargan bo'lishi mumkin (masalan nizo ochilgan),
 * bunday holatda vazifa hech narsa qilmasligi kerak.
 */
export function isSystemAction(action: DealAction): boolean {
  const t = TRANSITIONS.find((x) => x.action === action);
  return t?.actors.includes('system') ?? false;
}

/**
 * Shu holatda avtomatik timerlar ishlaydimi.
 *
 * §7 talabi: DISPUTED holatida BARCHA timerlar to'xtaydi. Bu funksiya
 * fon vazifalari uchun yagona haqiqat manbai.
 */
export function timersActive(status: DealStatus): boolean {
  if (status === 'DISPUTED') return false; // §7 — nizo timerlarni to'xtatadi
  if (status === 'PAYMENT_MISMATCH') return false; // admin qo'lda hal qiladi
  if (isTerminal(status)) return false;
  return true;
}
