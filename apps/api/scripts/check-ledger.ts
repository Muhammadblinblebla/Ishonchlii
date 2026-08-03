/**
 * LEDGER MUVOZANATI TEKSHIRUVI  (§4 talabi)
 *
 * CI har ishga tushganda chaqiriladi. Yig'indi 0 dan farq qilsa —
 * process.exit(1), build yiqiladi.
 *
 *   npm run ledger:check
 *
 * Tekshiriladigan invariantlar:
 *   1. Butun jadval bo'yicha SUM(amount) = 0
 *   2. Har bir transaction_id guruhi bo'yicha SUM(amount) = 0
 *   3. Hech bir foydalanuvchining `available` balansi manfiy emas
 *   4. platform:escrow manfiy emas (mavjud bo'lmagan pul tarqatilmagan)
 *   5. Har bir guruhda kamida 2 ta yozuv bor
 */

import './load-env.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface Problem {
  check: string;
  detail: string;
}

const problems: Problem[] = [];

/**
 * Xom SQL'dagi `SUM()` natijasini BigInt'ga keltiradi.
 *
 * Prisma `$queryRaw` da `SUM(bigint)` ni BigInt sifatida qaytarmaydi —
 * drayverga qarab `Decimal`, `string` yoki `number` bo'lishi mumkin. Uni
 * to'g'ridan-to'g'ri BigInt bilan `!==` orqali solishtirish HAR DOIM `true`
 * beradi, ya'ni tekshiruv jimgina yolg'on ogohlantirish chiqaradi.
 */
function toBigInt(value: unknown): bigint {
  if (value === null || value === undefined) return 0n;
  if (typeof value === 'bigint') return value;
  return BigInt(String(value));
}

function fmt(tiyin: bigint): string {
  const negative = tiyin < 0n;
  const soum = (negative ? -tiyin : tiyin) / 100n;
  const grouped = soum.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${negative ? '-' : ''}${grouped} so'm (${tiyin} tiyin)`;
}

async function main(): Promise<void> {
  console.log('\n  Ledger muvozanati tekshirilmoqda...\n');

  // ── 1. Umumiy yig'indi ────────────────────────────────────────────────────
  const total = await prisma.ledgerEntry.aggregate({ _sum: { amount: true } });
  const totalSum = total._sum.amount ?? 0n;
  const entryCount = await prisma.ledgerEntry.count();

  console.log(`  Jami yozuvlar : ${entryCount}`);
  console.log(`  Umumiy yig'indi: ${fmt(totalSum)}`);

  if (totalSum !== 0n) {
    problems.push({
      check: 'Umumiy yig\'indi',
      detail: `SUM(amount) = ${totalSum}, 0 bo'lishi shart. Pul yo'qolgan yoki yaratilgan.`,
    });
  }

  // ── 2. Har bir tranzaksiya guruhi ─────────────────────────────────────────
  const unbalanced = await prisma.$queryRaw<
    Array<{ transaction_id: string; sum: unknown; legs: unknown }>
  >`
    SELECT transaction_id, SUM(amount) AS sum, COUNT(*) AS legs
      FROM ledger_entries
     GROUP BY transaction_id
    HAVING SUM(amount) <> 0 OR COUNT(*) < 2
     LIMIT 50
  `;

  for (const row of unbalanced) {
    problems.push({
      check: 'Tranzaksiya muvozanati',
      detail:
        `transaction_id=${row.transaction_id}: ` +
        `yig'indi=${toBigInt(row.sum)}, oyoqlar=${toBigInt(row.legs)}`,
    });
  }

  // ── 3. Manfiy `available` balanslar ───────────────────────────────────────
  const negativeAvailable = await prisma.$queryRaw<
    Array<{ account_id: string; balance: unknown }>
  >`
    SELECT account_id, SUM(amount) AS balance
      FROM ledger_entries
     WHERE account_id LIKE 'user:%:available'
     GROUP BY account_id
    HAVING SUM(amount) < 0
     LIMIT 50
  `;

  for (const row of negativeAvailable) {
    problems.push({
      check: 'Manfiy balans',
      detail: `${row.account_id}: ${fmt(toBigInt(row.balance))} — foydalanuvchi mavjud bo'lmagan pulni yechib olgan.`,
    });
  }

  // ── 4. Manfiy pending balanslar ───────────────────────────────────────────
  const negativePending = await prisma.$queryRaw<
    Array<{ account_id: string; balance: unknown }>
  >`
    SELECT account_id, SUM(amount) AS balance
      FROM ledger_entries
     WHERE account_id LIKE 'user:%:pending'
     GROUP BY account_id
    HAVING SUM(amount) < 0
     LIMIT 50
  `;

  for (const row of negativePending) {
    problems.push({
      check: 'Manfiy muzlatilgan balans',
      detail: `${row.account_id}: ${fmt(toBigInt(row.balance))}`,
    });
  }

  // ── 5. platform:escrow manfiy emas ────────────────────────────────────────
  const escrow = await prisma.ledgerEntry.aggregate({
    where: { accountId: 'platform:escrow' },
    _sum: { amount: true },
  });
  const escrowBalance = escrow._sum.amount ?? 0n;

  console.log(`  Escrowdagi pul : ${fmt(escrowBalance)}`);

  if (escrowBalance < 0n) {
    problems.push({
      check: 'Escrow balansi',
      detail: `platform:escrow = ${fmt(escrowBalance)} — mavjud bo'lmagan pul tarqatilgan.`,
    });
  }

  // ── 6. Escrow = barcha pending yig'indisi ─────────────────────────────────
  const pendingTotal = await prisma.$queryRaw<Array<{ sum: unknown }>>`
    SELECT SUM(amount) AS sum
      FROM ledger_entries
     WHERE account_id LIKE 'user:%:pending'
  `;
  const pendingSum = toBigInt(pendingTotal[0]?.sum);

  if (pendingSum !== escrowBalance) {
    problems.push({
      check: 'Escrow ↔ pending mosligi',
      detail:
        `platform:escrow = ${fmt(escrowBalance)}, lekin barcha pending yig'indisi = ${fmt(pendingSum)}. ` +
        `Ikkalasi teng bo'lishi shart.`,
    });
  }

  // ── Natija ────────────────────────────────────────────────────────────────
  console.log('');

  if (problems.length === 0) {
    console.log('  ✅ Barcha invariantlar joyida. Pul muvozanatda.\n');
    return;
  }

  console.error(`  ❌ ${problems.length} ta muammo topildi:\n`);
  for (const p of problems) {
    console.error(`     [${p.check}]`);
    console.error(`       ${p.detail}\n`);
  }
  process.exitCode = 1;
}

main()
  .catch((err: unknown) => {
    console.error('\n  ❌ Tekshiruv bajarilmadi:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
