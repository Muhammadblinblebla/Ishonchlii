/**
 * Ledger testlari — HAQIQIY bazaga yozadi.
 *
 * Mock ishlatilmaydi: tekshirmoqchi bo'lgan narsalarimizning ko'pi aynan
 * bazada (DEFERRABLE trigger, unique cheklov, tranzaksiya izolyatsiyasi).
 *
 * DIQQAT: bu testlar ledgerga yozadi va yozuvlar O'CHIRILMAYDI (append-only).
 * Shuning uchun har bir test MUVOZANATLI harakat yozadi — aks holda
 * `npm run ledger:check` keyinchalik yiqilardi.
 */

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PLATFORM_ESCROW,
  PLATFORM_REVENUE,
  userAvailable,
  userPending,
} from '@escrowuz/shared';
import { prisma } from '../src/db/prisma.js';
import {
  LedgerError,
  depositLegs,
  getBalance,
  payoutLegs,
  post,
  refundLegs,
  releaseLegs,
} from '../src/ledger/ledger.service.js';
import { cleanupTestUsers, uniqueEmail } from './helpers/setup.js';

const AMOUNT = 10_000_000n; // 100 000 so'm
const COMMISSION = 300_000n; // 3%

let buyerId: string;
let sellerId: string;

beforeAll(async () => {
  const buyer = await prisma.user.create({
    data: { email: uniqueEmail('ledger-buyer'), fullName: 'Xaridor', passwordHash: 'x' },
  });
  const seller = await prisma.user.create({
    data: { email: uniqueEmail('ledger-seller'), fullName: 'Sotuvchi', passwordHash: 'x' },
  });
  buyerId = buyer.id;
  sellerId = seller.id;
});

afterAll(async () => {
  await cleanupTestUsers();
  await prisma.$disconnect();
});

const key = (): string => `test-${randomUUID()}`;

// ─────────────────────────────────────────────────────────────────────────────

describe('post() — muvozanat majburiyati', () => {
  it('muvozanatli tranzaksiyani yozadi', async () => {
    const result = await post({
      legs: depositLegs(sellerId, AMOUNT, 'test'),
      idempotencyKey: key(),
    });

    expect(result.wasReplay).toBe(false);
    expect(result.transactionId).toBeTruthy();

    const entries = await prisma.ledgerEntry.findMany({
      where: { transactionId: result.transactionId },
    });
    expect(entries).toHaveLength(4);
    expect(entries.reduce((s, e) => s + e.amount, 0n)).toBe(0n);
  });

  it('muvozanatsiz tranzaksiyani RAD ETADI', async () => {
    await expect(
      post({
        legs: [
          { accountId: PLATFORM_ESCROW, amount: 100n, entryType: 'deposit' },
          { accountId: 'external:test', amount: -50n, entryType: 'deposit' },
        ],
        idempotencyKey: key(),
      }),
    ).rejects.toThrow(LedgerError);
  });

  it('bitta oyoqli tranzaksiyani RAD ETADI', async () => {
    await expect(
      post({
        legs: [{ accountId: PLATFORM_ESCROW, amount: 100n, entryType: 'deposit' }],
        idempotencyKey: key(),
      }),
    ).rejects.toThrow(LedgerError);
  });

  it('nol summali oyoqni RAD ETADI', async () => {
    await expect(
      post({
        legs: [
          { accountId: PLATFORM_ESCROW, amount: 0n, entryType: 'deposit' },
          { accountId: 'external:test', amount: 0n, entryType: 'deposit' },
        ],
        idempotencyKey: key(),
      }),
    ).rejects.toThrow(LedgerError);
  });

  it('rad etilgan tranzaksiya bazaga HECH NARSA yozmaydi', async () => {
    const k = key();
    await expect(
      post({
        legs: [
          { accountId: PLATFORM_ESCROW, amount: 100n, entryType: 'deposit' },
          { accountId: 'external:test', amount: -50n, entryType: 'deposit' },
        ],
        idempotencyKey: k,
      }),
    ).rejects.toThrow();

    const leaked = await prisma.ledgerEntry.count({
      where: { idempotencyKey: { startsWith: k } },
    });
    expect(leaked).toBe(0);
  });
});

describe('Idempotentlik — pul ikki marta o\'tmaydi (§12)', () => {
  it('bir xil kalit bilan ikkinchi chaqiruv HECH NARSA yozmaydi', async () => {
    const k = key();
    const legs = depositLegs(sellerId, AMOUNT, 'test');

    const first = await post({ legs, idempotencyKey: k });
    const second = await post({ legs, idempotencyKey: k });

    expect(first.wasReplay).toBe(false);
    expect(second.wasReplay).toBe(true);
    expect(second.transactionId).toBe(first.transactionId);

    const count = await prisma.ledgerEntry.count({
      where: { idempotencyKey: { startsWith: `${k}:` } },
    });
    expect(count).toBe(4); // 8 emas
  });

  it('10 marta ketma-ket chaqirilsa ham bir marta yoziladi', async () => {
    const k = key();
    const legs = depositLegs(sellerId, AMOUNT, 'test');

    for (let i = 0; i < 10; i++) {
      await post({ legs, idempotencyKey: k });
    }

    const entries = await prisma.ledgerEntry.findMany({
      where: { idempotencyKey: { startsWith: `${k}:` } },
    });
    expect(entries).toHaveLength(4);
  });

  it('PARALLEL chaqiruvlarda ham faqat bittasi yozadi (race condition)', async () => {
    // §12: "Ikkita parallel confirm so'rovi — faqat bittasi o'tadi"
    const k = key();
    const legs = depositLegs(sellerId, AMOUNT, 'test');

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => post({ legs, idempotencyKey: k })),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled.length).toBeGreaterThan(0);

    // Nechta so'rov muvaffaqiyatli bo'lishidan qat'i nazar — yozuv 4 ta
    const entries = await prisma.ledgerEntry.findMany({
      where: { idempotencyKey: { startsWith: `${k}:` } },
    });
    expect(entries).toHaveLength(4);

    // Hammasi bir xil tranzaksiyaga tegishli
    const txIds = new Set(entries.map((e) => e.transactionId));
    expect(txIds.size).toBe(1);
  });
});

describe('To\'liq savdo sikli — pul yo\'qolmaydi', () => {
  it('to\'lov → yakunlash: sotuvchi 9 700 000, platforma 300 000', async () => {
    const seller = await prisma.user.create({
      data: { email: uniqueEmail('cycle-seller'), fullName: 'S', passwordHash: 'x' },
    });

    const before = await getBalance(seller.id);
    expect(before.availableTiyin).toBe(0n);
    expect(before.pendingTiyin).toBe(0n);

    // 1. To'lov keldi
    await post({ legs: depositLegs(seller.id, AMOUNT, 'test'), idempotencyKey: key() });

    const funded = await getBalance(seller.id);
    expect(funded.pendingTiyin).toBe(AMOUNT); // muzlatilgan
    expect(funded.availableTiyin).toBe(0n); // hali yechib bo'lmaydi

    // 2. Xaridor tasdiqladi
    await post({
      legs: releaseLegs(seller.id, AMOUNT, AMOUNT - COMMISSION, COMMISSION),
      idempotencyKey: key(),
    });

    const done = await getBalance(seller.id);
    expect(done.pendingTiyin).toBe(0n); // muzlatilgan qismi bo'shadi
    expect(done.availableTiyin).toBe(9_700_000n); // yechib olsa bo'ladi
  });

  it('savdo bo\'yicha barcha yozuvlar yig\'indisi 0', async () => {
    const seller = await prisma.user.create({
      data: { email: uniqueEmail('sum-seller'), fullName: 'S', passwordHash: 'x' },
    });
    const dealId = randomUUID();

    // Savdo yozuvi bo'lmagani uchun dealId'ni bermaymiz (FK cheklovi bor),
    // lekin tranzaksiyalar bo'yicha yig'indini tekshiramiz.
    const t1 = await post({ legs: depositLegs(seller.id, AMOUNT, 'test'), idempotencyKey: key() });
    const t2 = await post({
      legs: releaseLegs(seller.id, AMOUNT, AMOUNT - COMMISSION, COMMISSION),
      idempotencyKey: key(),
    });

    for (const txId of [t1.transactionId, t2.transactionId]) {
      const entries = await prisma.ledgerEntry.findMany({ where: { transactionId: txId } });
      expect(entries.reduce((s, e) => s + e.amount, 0n), `tx ${txId}`).toBe(0n);
    }
    expect(dealId).toBeTruthy();
  });

  it('releaseLegs taqsimot escrowga teng bo\'lmasa RAD ETADI', () => {
    expect(() => releaseLegs(sellerId, AMOUNT, 9_000_000n, 300_000n)).toThrow(LedgerError);
  });
});

describe('Qaytarish', () => {
  it('to\'liq qaytarish: xaridor hammasini oladi, platforma 0', async () => {
    const buyer = await prisma.user.create({
      data: { email: uniqueEmail('rf-buyer'), fullName: 'B', passwordHash: 'x' },
    });
    const seller = await prisma.user.create({
      data: { email: uniqueEmail('rf-seller'), fullName: 'S', passwordHash: 'x' },
    });

    await post({ legs: depositLegs(seller.id, AMOUNT, 'test'), idempotencyKey: key() });
    await post({
      legs: refundLegs(buyer.id, seller.id, AMOUNT, AMOUNT, 0n, 0n),
      idempotencyKey: key(),
    });

    expect((await getBalance(buyer.id)).availableTiyin).toBe(AMOUNT);
    expect((await getBalance(seller.id)).pendingTiyin).toBe(0n);
    expect((await getBalance(seller.id)).availableTiyin).toBe(0n);
  });

  it('bo\'lib qaytarish: 60/40 + komissiya', async () => {
    const buyer = await prisma.user.create({
      data: { email: uniqueEmail('sp-buyer'), fullName: 'B', passwordHash: 'x' },
    });
    const seller = await prisma.user.create({
      data: { email: uniqueEmail('sp-seller'), fullName: 'S', passwordHash: 'x' },
    });

    await post({ legs: depositLegs(seller.id, AMOUNT, 'test'), idempotencyKey: key() });
    await post({
      legs: refundLegs(buyer.id, seller.id, AMOUNT, 5_820_000n, 3_880_000n, COMMISSION),
      idempotencyKey: key(),
    });

    expect((await getBalance(buyer.id)).availableTiyin).toBe(5_820_000n);
    expect((await getBalance(seller.id)).availableTiyin).toBe(3_880_000n);
    expect((await getBalance(seller.id)).pendingTiyin).toBe(0n);
  });

  it('taqsimot escrowga teng bo\'lmasa RAD ETADI', () => {
    expect(() => refundLegs(buyerId, sellerId, AMOUNT, 5_000_000n, 3_000_000n, 0n)).toThrow(
      LedgerError,
    );
  });
});

describe('Yechish (payout)', () => {
  it('available balansdan chiqadi', async () => {
    const seller = await prisma.user.create({
      data: { email: uniqueEmail('po-seller'), fullName: 'S', passwordHash: 'x' },
    });

    await post({ legs: depositLegs(seller.id, AMOUNT, 'test'), idempotencyKey: key() });
    await post({
      legs: releaseLegs(seller.id, AMOUNT, AMOUNT - COMMISSION, COMMISSION),
      idempotencyKey: key(),
    });
    await post({ legs: payoutLegs(seller.id, 5_000_000n, 'test'), idempotencyKey: key() });

    expect((await getBalance(seller.id)).availableTiyin).toBe(4_700_000n);
  });
});

describe('Balans HAR DOIM ledgerdan hisoblanadi', () => {
  it('users jadvalida balance ustuni YO\'Q', async () => {
    const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
       WHERE table_name = 'users' AND table_schema = 'public'
    `;
    const names = columns.map((c) => c.column_name);
    expect(names).not.toContain('balance');
    expect(names).not.toContain('available');
    expect(names).not.toContain('pending');
  });

  it('yozuvsiz foydalanuvchi balansi 0', async () => {
    const fresh = await prisma.user.create({
      data: { email: uniqueEmail('zero'), fullName: 'Z', passwordHash: 'x' },
    });
    const balance = await getBalance(fresh.id);
    expect(balance.availableTiyin).toBe(0n);
    expect(balance.pendingTiyin).toBe(0n);
  });
});

describe('Bu test faylining o\'zi ledgerni buzmadi', () => {
  it('yozilgan barcha test tranzaksiyalari muvozanatda', async () => {
    const unbalanced = await prisma.$queryRaw<Array<{ transaction_id: string; sum: bigint }>>`
      SELECT transaction_id, SUM(amount) AS sum
        FROM ledger_entries
       GROUP BY transaction_id
      HAVING SUM(amount) <> 0
    `;
    expect(unbalanced).toHaveLength(0);
  });

  it('butun jadval yig\'indisi 0 (§4)', async () => {
    const total = await prisma.ledgerEntry.aggregate({ _sum: { amount: true } });
    expect(total._sum.amount ?? 0n).toBe(0n);
  });

  it('hech kimning available balansi manfiy emas', async () => {
    const negative = await prisma.$queryRaw<Array<{ account_id: string }>>`
      SELECT account_id FROM ledger_entries
       WHERE account_id LIKE 'user:%:available'
       GROUP BY account_id HAVING SUM(amount) < 0
    `;
    expect(negative).toHaveLength(0);
  });

  it('escrow = barcha pending yig\'indisi', async () => {
    const rows = await prisma.$queryRaw<Array<{ escrow: unknown; pending: unknown }>>`
      SELECT
        (SELECT SUM(amount) FROM ledger_entries WHERE account_id = ${PLATFORM_ESCROW}) AS escrow,
        (SELECT SUM(amount) FROM ledger_entries WHERE account_id LIKE 'user:%:pending') AS pending
    `;
    // Xom SQL'dagi SUM() BigInt qaytarmaydi (Decimal/string bo'lishi mumkin).
    // To'g'ridan-to'g'ri solishtirish qiymatlar teng bo'lsa ham `false` beradi.
    const toBig = (v: unknown): bigint => (v === null || v === undefined ? 0n : BigInt(String(v)));
    expect(toBig(rows[0]!.escrow)).toBe(toBig(rows[0]!.pending));
  });

  it('platform:revenue manfiy emas', async () => {
    const revenue = await prisma.ledgerEntry.aggregate({
      where: { accountId: PLATFORM_REVENUE },
      _sum: { amount: true },
    });
    expect(revenue._sum.amount ?? 0n).toBeGreaterThanOrEqual(0n);
  });
});

describe('Hisob nomlari qo\'lda yozilmaydi', () => {
  it('yordamchi funksiyalar to\'g\'ri format beradi', () => {
    expect(userAvailable('abc')).toBe('user:abc:available');
    expect(userPending('abc')).toBe('user:abc:pending');
  });
});
