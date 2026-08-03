/**
 * Savdo holatlari. Bu ro'yxat Prisma sxemasidagi `DealStatus` enum bilan
 * AYNAN bir xil bo'lishi shart — `apps/api/test/schema-sync.test.ts` buni tekshiradi.
 *
 * O'tish qoidalari bu yerda emas, `deal-state-machine.ts` faylida.
 */
export const DEAL_STATUSES = [
  'DRAFT',
  'AWAITING_PAYMENT',
  'FUNDED',
  'SHIPPED',
  'DELIVERED',
  'AUTO_RELEASED',
  'DISPUTED',
  'RESOLVED_BUYER',
  'RESOLVED_SELLER',
  'RESOLVED_SPLIT',
  'REFUNDED',
  'CANCELLED',
  'EXPIRED',
  'PAYMENT_MISMATCH',
] as const;

export type DealStatus = (typeof DEAL_STATUSES)[number];

/**
 * Yakuniy holatlar — bulardan hech qayerga o'tib bo'lmaydi.
 *
 * PAYMENT_MISMATCH bu yerda YO'Q: webhook summasi mos kelmaganda savdo shu
 * holatga tushadi va admin qo'lda hal qiladi (§5). Ya'ni u "muzlatilgan
 * kutish" holati, yakuniy emas.
 */
export const TERMINAL_STATUSES = [
  'DELIVERED',
  'AUTO_RELEASED',
  'RESOLVED_BUYER',
  'RESOLVED_SELLER',
  'RESOLVED_SPLIT',
  'REFUNDED',
  'CANCELLED',
  'EXPIRED',
] as const satisfies readonly DealStatus[];

export type TerminalStatus = (typeof TERMINAL_STATUSES)[number];

const TERMINAL_SET: ReadonlySet<string> = new Set(TERMINAL_STATUSES);

export function isTerminal(status: DealStatus): status is TerminalStatus {
  return TERMINAL_SET.has(status);
}

/**
 * Pul escrowda MUZLATILGAN holatlar. Bu holatlarda:
 *   - `platform:escrow` da mablag' turadi
 *   - sotuvchining `pending` balansida aks etadi
 *   - savdoni oddiy `cancel` bilan yopib bo'lmaydi (pul qayerga ketishi hal bo'lishi kerak)
 */
export const ESCROW_HELD_STATUSES = [
  'FUNDED',
  'SHIPPED',
  'DISPUTED',
  'PAYMENT_MISMATCH',
] as const satisfies readonly DealStatus[];

const ESCROW_HELD_SET: ReadonlySet<string> = new Set(ESCROW_HELD_STATUSES);

export function holdsEscrow(status: DealStatus): boolean {
  return ESCROW_HELD_SET.has(status);
}
