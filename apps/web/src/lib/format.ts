/**
 * Formatlash yordamchilari.
 *
 * `formatTiyin` shared paketidan keladi — server va mijoz bir xil qoidani
 * ishlatishi shart, aks holda foydalanuvchi ikki joyda ikki xil summa ko'radi.
 */

import { formatTiyin } from '@escrowuz/shared';

export { formatTiyin };

/** Satr sifatida kelgan tiyinni formatlaydi. */
export function formatAmount(tiyinString: string, options?: { withCurrency?: boolean }): string {
  try {
    return formatTiyin(BigInt(tiyinString), options ?? {});
  } catch {
    return '—';
  }
}

/** `"1234567"` (so'm kiritilgan) → tiyin satri. */
export function soumToTiyin(soum: string): string {
  const digits = soum.replace(/\D/g, '');
  if (!digits) return '0';
  return (BigInt(digits) * 100n).toString();
}

/** Kiritish maydonida raqamlarni probel bilan ajratadi: `100000` → `100 000` */
export function groupDigits(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

const MONTHS = [
  'yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun',
  'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr',
];

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()}-${MONTHS[d.getMonth()]}, ${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes(),
  ).padStart(2, '0')}`;
}

export function formatDateShort(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()}-${MONTHS[d.getMonth()]}`;
}

/** Qolgan vaqtni millisekundda qaytaradi. O'tib ketgan bo'lsa 0. */
export function remainingMs(iso: string | null): number {
  if (!iso) return 0;
  return Math.max(0, new Date(iso).getTime() - Date.now());
}
