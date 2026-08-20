/**
 * Prisma sxemasi ↔ `@escrowuz/shared` mosligi.
 *
 * Nega kerak: holatlar ro'yxati ikki joyda yozilgan — Prisma enumida va
 * shared paketida. Ular ajralib ketsa, kod kompilyatsiyadan o'tadi, lekin
 * ish vaqtida baza noma'lum enum qiymatini rad etadi — ya'ni savdo o'rtada
 * qotib qoladi va pul muzlagan holda turaveradi.
 *
 * Bu testlar bazaga ULANMAYDI — generatsiya qilingan tiplarni o'qiydi.
 */

import { describe, expect, it } from 'vitest';
import {
  CONTENT_KINDS,
  DEAL_STATUSES,
  DEAL_TYPES,
  DEAL_TYPE_RULES,
  TERMINAL_STATUSES,
  ESCROW_HELD_STATUSES,
  isTerminal,
  holdsEscrow,
  COMMISSION_POLICY,
} from '@escrowuz/shared';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const schemaPath = fileURLToPath(new URL('../prisma/schema.prisma', import.meta.url));
const schema = readFileSync(schemaPath, 'utf8');

/** `enum X { a b c }` blokidan qiymatlarni ajratib oladi. */
function enumValues(name: string): string[] {
  const block = new RegExp(`enum\\s+${name}\\s*\\{([^}]*)\\}`).exec(schema);
  if (!block?.[1]) throw new Error(`Sxemada "${name}" enumi topilmadi`);
  return block[1]
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').trim())
    .filter((line) => line.length > 0 && !line.startsWith('/'));
}

describe('Prisma sxemasi shared paketiga mos', () => {
  it('DealStatus enumi DEAL_STATUSES bilan aynan bir xil', () => {
    expect(enumValues('DealStatus')).toEqual([...DEAL_STATUSES]);
  });

  it('CommissionPayer enumi siyosat tiplariga mos', () => {
    expect(enumValues('CommissionPayer')).toEqual(['buyer', 'seller', 'split']);
  });

  it('ContentKind enumi CONTENT_KINDS bilan aynan bir xil', () => {
    expect(enumValues('ContentKind')).toEqual([...CONTENT_KINDS]);
  });

  it('DealType enumi DEAL_TYPES bilan aynan bir xil', () => {
    // Ajralib ketsa: yangi tur bilan savdo yaratish ish vaqtida rad etiladi,
    // yoki bazada shared bilmaydigan tur paydo bo'lib, auto-release muddati
    // jimgina 7 kunga (standart) tushib qoladi.
    expect(enumValues('DealType')).toEqual([...DEAL_TYPES]);
  });

  it('har bir savdo turi uchun qoida mavjud', () => {
    for (const type of DEAL_TYPES) {
      expect(DEAL_TYPE_RULES[type], type).toBeDefined();
    }
  });

  it('bazadagi yakuniy holat triggeri TERMINAL_STATUSES bilan bir xil', () => {
    // Trigger baza darajasidagi ikkinchi himoya qavati. U shared'dagi
    // ro'yxatdan ortda qolsa, yakuniy savdo qayta ochilib ketishi mumkin.
    const guardPath = fileURLToPath(
      new URL('../prisma/migrations/20260803000100_guards/migration.sql', import.meta.url),
    );
    const guard = readFileSync(guardPath, 'utf8');

    const listed = /OLD\.status IN \(([^)]*)\)/s.exec(guard);
    expect(listed?.[1], 'guards migratsiyasida yakuniy holatlar ro\'yxati topilmadi').toBeTruthy();

    const inTrigger = [...listed![1]!.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
    expect(inTrigger.sort()).toEqual([...TERMINAL_STATUSES].sort());
  });
});

describe('Holat yordamchilari', () => {
  it('har bir yakuniy holat isTerminal orqali aniqlanadi', () => {
    for (const status of TERMINAL_STATUSES) {
      expect(isTerminal(status), status).toBe(true);
    }
  });

  it('yakuniy bo\'lmagan holatlar isTerminal dan o\'tmaydi', () => {
    const nonTerminal = DEAL_STATUSES.filter(
      (s) => !(TERMINAL_STATUSES as readonly string[]).includes(s),
    );
    // DRAFT, AWAITING_PAYMENT, FUNDED, SHIPPED, DISPUTED, PAYMENT_MISMATCH
    expect(nonTerminal).toHaveLength(6);
    for (const status of nonTerminal) {
      expect(isTerminal(status), status).toBe(false);
    }
  });

  it('escrow ushlab turadigan holatlarning hech biri yakuniy emas', () => {
    // Aks holda pul yakuniy holatda muzlab qolardi va uni chiqarib bo'lmasdi.
    for (const status of ESCROW_HELD_STATUSES) {
      expect(isTerminal(status), `${status} ham escrow ushlaydi, ham yakuniy`).toBe(false);
      expect(holdsEscrow(status)).toBe(true);
    }
  });

  it('DISPUTED escrowni ushlab turadi', () => {
    // Nizo paytida pul muzlatilgan holda qolishi shart (§7).
    expect(holdsEscrow('DISPUTED')).toBe(true);
  });
});

describe('Komissiya siyosati mantiqan to\'g\'ri', () => {
  it('stavka 0..10000 bps oralig\'ida va butun son', () => {
    expect(Number.isInteger(COMMISSION_POLICY.rateBps)).toBe(true);
    expect(COMMISSION_POLICY.rateBps).toBeGreaterThanOrEqual(0);
    expect(COMMISSION_POLICY.rateBps).toBeLessThanOrEqual(10_000);
  });

  it('barcha summa chegaralari butun son va mantiqiy', () => {
    const { minDealAmountTiyin, maxDealAmountTiyin, minCommissionTiyin } = COMMISSION_POLICY;
    expect(Number.isInteger(minDealAmountTiyin)).toBe(true);
    expect(Number.isInteger(maxDealAmountTiyin)).toBe(true);
    expect(minDealAmountTiyin).toBeGreaterThan(0);
    expect(maxDealAmountTiyin).toBeGreaterThan(minDealAmountTiyin);
    expect(minCommissionTiyin).toBeGreaterThanOrEqual(0);
  });

  it('split ulushi 0..10000 bps oralig\'ida', () => {
    expect(COMMISSION_POLICY.splitPayerBuyerShareBps).toBeGreaterThanOrEqual(0);
    expect(COMMISSION_POLICY.splitPayerBuyerShareBps).toBeLessThanOrEqual(10_000);
  });

  it('pul qaytishi mumkin bo\'lgan har bir holat uchun qoida belgilangan', () => {
    // Qoida yozilmagan holat qolsa, o'sha holatda komissiya bilan nima
    // qilish noma'lum bo'lib qoladi — pul osilib qoladi.
    for (const status of ['REFUNDED', 'RESOLVED_BUYER', 'RESOLVED_SPLIT', 'EXPIRED', 'CANCELLED'] as const) {
      expect(COMMISSION_POLICY.refundRules[status], status).toBeDefined();
    }
  });
});
