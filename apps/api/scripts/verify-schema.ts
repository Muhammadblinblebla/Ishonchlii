/**
 * Bazadagi himoya qavatlarini HAQIQATDA sinab ko'radi.
 *
 * Jadval va trigger yaratilgani yetarli emas — ular pulni to'sishi kerak.
 * Bu skript ataylab noto'g'ri amallarni bajarib, baza ularni rad etishini
 * tekshiradi.
 *
 * MUHIM ikkita nuqta:
 *   - `ledger_entries_balanced` trigger DEFERRABLE: u COMMIT paytida ishlaydi.
 *     Shuning uchun uni tranzaksiya ichida sinab bo'lmaydi — commit qilish kerak.
 *   - Satr darajasidagi triggerlar bo'sh jadvalda ishga tushmaydi. Avval
 *     haqiqiy qator yaratiladi, keyin u ustida amal sinaladi.
 *
 * Barcha sinovlar ROLLBACK bilan tugaydi — bazada hech narsa qolmaydi.
 *
 *   npx tsx scripts/verify-schema.ts
 */

import './load-env.js';
import { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';

const prisma = new PrismaClient();

let passed = 0;
let failed = 0;

function ok(name: string): void {
  passed++;
  console.log(`  ✅ ${name}`);
}

function bad(name: string, detail: string): void {
  failed++;
  console.log(`  ❌ ${name}\n       ${detail}`);
}

const ROLLBACK = '__ROLLBACK_SENTINEL__';

/**
 * `body` ichidagi amal baza tomonidan RAD ETILISHI kutiladi.
 * Tranzaksiya har holatda ROLLBACK bo'ladi.
 */
async function expectRejected(
  name: string,
  body: (tx: Prisma.TransactionClient) => Promise<void>,
): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      await body(tx);
      // Bu yergacha yetdik = amal rad etilmadi.
      throw new Error(ROLLBACK + ':NOT_REJECTED');
    });
    bad(name, 'Baza amalni RAD ETMADI.');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('NOT_REJECTED')) {
      bad(name, 'Baza amalni RAD ETMADI — himoya ishlamayapti.');
    } else {
      ok(name);
    }
  }
}

/** `body` MUVAFFAQIYATLI bajarilishi kutiladi. Oxirida ROLLBACK. */
async function expectAccepted(
  name: string,
  body: (tx: Prisma.TransactionClient) => Promise<void>,
): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      await body(tx);
      throw new Error(ROLLBACK);
    });
    bad(name, 'Kutilmagan holat.');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === ROLLBACK) ok(name);
    else bad(name, `Baza amalni rad etdi, holbuki qabul qilishi kerak edi:\n       ${msg.split('\n')[0]}`);
  }
}

// ─── Test ma'lumotlari yaratuvchi yordamchilar ───────────────────────────────

async function makeUser(tx: Prisma.TransactionClient, tag: string): Promise<string> {
  const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO users (id, email, password_hash, full_name, role, is_verified, created_at, updated_at)
     VALUES (gen_random_uuid(), 'verify-${tag}-' || gen_random_uuid() || '@test.local',
             'x', 'Tekshiruv', 'user', false, now(), now())
     RETURNING id`,
  );
  return rows[0]!.id;
}

async function makeDeal(
  tx: Prisma.TransactionClient,
  buyerId: string,
  sellerId: string,
  status = 'DRAFT',
): Promise<string> {
  const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO deals
       (id, buyer_id, seller_id, title, description, amount_tiyin, commission_tiyin,
        commission_bps, commission_payer, currency, status, version, created_at, updated_at)
     VALUES (gen_random_uuid(), '${buyerId}', '${sellerId}', 'Tekshiruv savdosi', '',
             10000000, 300000, 300, 'seller', 'UZS', '${status}', 0, now(), now())
     RETURNING id`,
  );
  return rows[0]!.id;
}

/** Muvozanatli ikki oyoqli ledger yozuvi qo'shadi. */
async function makeBalancedLedger(tx: Prisma.TransactionClient): Promise<string> {
  const txnRows = await tx.$queryRawUnsafe<Array<{ id: string }>>(`SELECT gen_random_uuid() AS id`);
  const txnId = txnRows[0]!.id;
  await tx.$executeRawUnsafe(
    `INSERT INTO ledger_entries
       (id, account_id, amount, currency, entry_type, transaction_id, idempotency_key, created_at)
     VALUES
       (gen_random_uuid(), 'external:test', -10000000, 'UZS', 'deposit',
        '${txnId}', 'verify-a-' || gen_random_uuid(), now()),
       (gen_random_uuid(), 'platform:escrow', 10000000, 'UZS', 'deposit',
        '${txnId}', 'verify-b-' || gen_random_uuid(), now())`,
  );
  return txnId;
}

// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n─── Jadvallar ──────────────────────────────────────────────\n');

  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
     WHERE schemaname = 'public' AND tablename NOT LIKE '\\_prisma%'
     ORDER BY tablename
  `;
  const names = tables.map((t) => t.tablename);
  console.log(`  ${names.length} ta: ${names.join(', ')}\n`);

  const expected = [
    'deal_events', 'deals', 'dispute_files', 'disputes', 'idempotency_records',
    'invoices', 'ledger_entries', 'payouts', 'refresh_tokens', 'shipments',
    'users', 'webhook_events',
  ];
  const missing = expected.filter((t) => !names.includes(t));
  if (missing.length === 0) ok('Barcha 12 ta jadval mavjud');
  else bad('Jadvallar', `yetishmayapti: ${missing.join(', ')}`);

  console.log('\n─── Triggerlar o\'rnatilgan ─────────────────────────────────\n');

  const triggers = await prisma.$queryRaw<Array<{ tgname: string; tbl: string }>>`
    SELECT t.tgname, c.relname AS tbl
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND NOT t.tgisinternal
     ORDER BY c.relname, t.tgname
  `;
  const haveTriggers = triggers.map((t) => t.tgname);
  const wantTriggers = [
    'ledger_entries_append_only', 'ledger_entries_no_truncate',
    'ledger_entries_balanced', 'deal_events_append_only',
    'deal_events_no_truncate', 'deals_terminal_guard',
  ];
  const missingTriggers = wantTriggers.filter((t) => !haveTriggers.includes(t));
  if (missingTriggers.length === 0) ok(`Barcha 6 ta trigger o'rnatilgan (${haveTriggers.length} ta jami)`);
  else bad('Triggerlar', `yetishmayapti: ${missingTriggers.join(', ')}`);

  console.log('\n─── LEDGER: muvozanat ──────────────────────────────────────\n');

  // Muvozanatli yozuv QABUL QILINISHI kerak — trigger haddan tashqari qattiq
  // bo'lsa, haqiqiy pul harakati ham bloklanib qolardi.
  await expectAccepted('Muvozanatli (yig\'indi = 0) tranzaksiya qabul qilinadi', async (tx) => {
    await makeBalancedLedger(tx);
  });

  // DEFERRABLE trigger COMMIT paytida ishlaydi → tranzaksiyasiz (autocommit)
  // yuboriladi, xato commit paytida ko'tariladi.
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO ledger_entries
         (id, account_id, amount, currency, entry_type, transaction_id, idempotency_key, created_at)
       VALUES (gen_random_uuid(), 'platform:escrow', 100, 'UZS', 'deposit',
               gen_random_uuid(), 'verify-unbal-' || gen_random_uuid(), now())`,
    );
    bad('Muvozanatsiz tranzaksiya rad etiladi (yig\'indi ≠ 0)', 'COMMIT o\'tib ketdi!');
  } catch {
    ok('Muvozanatsiz tranzaksiya COMMIT paytida rad etiladi (yig\'indi ≠ 0)');
  }

  // Bitta oyoqli tranzaksiya ham rad etilishi kerak
  try {
    const txnRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(`SELECT gen_random_uuid() AS id`);
    const txnId = txnRows[0]!.id;
    await prisma.$executeRawUnsafe(
      `INSERT INTO ledger_entries
         (id, account_id, amount, currency, entry_type, transaction_id, idempotency_key, created_at)
       VALUES (gen_random_uuid(), 'platform:escrow', 0, 'UZS', 'deposit',
               '${txnId}', 'verify-single-' || gen_random_uuid(), now())`,
    );
    bad('Bitta oyoqli tranzaksiya rad etiladi', 'COMMIT o\'tib ketdi!');
  } catch {
    ok('Nol summa / bitta oyoqli tranzaksiya rad etiladi');
  }

  console.log('\n─── LEDGER: append-only ────────────────────────────────────\n');

  await expectRejected('ledger_entries UPDATE rad etiladi', async (tx) => {
    const txnId = await makeBalancedLedger(tx);
    await tx.$executeRawUnsafe(
      `UPDATE ledger_entries SET amount = 999 WHERE transaction_id = '${txnId}'`,
    );
  });

  await expectRejected('ledger_entries DELETE rad etiladi', async (tx) => {
    const txnId = await makeBalancedLedger(tx);
    await tx.$executeRawUnsafe(`DELETE FROM ledger_entries WHERE transaction_id = '${txnId}'`);
  });

  console.log('\n─── DEAL_EVENTS: append-only ───────────────────────────────\n');

  await expectRejected('deal_events UPDATE rad etiladi', async (tx) => {
    const buyer = await makeUser(tx, 'b');
    const seller = await makeUser(tx, 's');
    const dealId = await makeDeal(tx, buyer, seller);
    await tx.$executeRawUnsafe(
      `INSERT INTO deal_events (id, deal_id, actor_id, from_status, to_status, action, created_at)
       VALUES (gen_random_uuid(), '${dealId}', '${buyer}', 'DRAFT', 'AWAITING_PAYMENT', 'deal.accepted', now())`,
    );
    await tx.$executeRawUnsafe(`UPDATE deal_events SET reason = 'buzildi' WHERE deal_id = '${dealId}'`);
  });

  await expectRejected('deal_events DELETE rad etiladi', async (tx) => {
    const buyer = await makeUser(tx, 'b');
    const seller = await makeUser(tx, 's');
    const dealId = await makeDeal(tx, buyer, seller);
    await tx.$executeRawUnsafe(
      `INSERT INTO deal_events (id, deal_id, actor_id, from_status, to_status, action, created_at)
       VALUES (gen_random_uuid(), '${dealId}', '${buyer}', 'DRAFT', 'AWAITING_PAYMENT', 'deal.accepted', now())`,
    );
    await tx.$executeRawUnsafe(`DELETE FROM deal_events WHERE deal_id = '${dealId}'`);
  });

  console.log('\n─── DEALS: yakuniy holat qulfi ─────────────────────────────\n');

  await expectRejected('DELIVERED savdoni FUNDED ga qaytarib bo\'lmaydi', async (tx) => {
    const buyer = await makeUser(tx, 'b');
    const seller = await makeUser(tx, 's');
    const dealId = await makeDeal(tx, buyer, seller, 'DELIVERED');
    await tx.$executeRawUnsafe(`UPDATE deals SET status = 'FUNDED' WHERE id = '${dealId}'`);
  });

  await expectRejected('REFUNDED savdoni qayta ochib bo\'lmaydi', async (tx) => {
    const buyer = await makeUser(tx, 'b');
    const seller = await makeUser(tx, 's');
    const dealId = await makeDeal(tx, buyer, seller, 'REFUNDED');
    await tx.$executeRawUnsafe(`UPDATE deals SET status = 'DISPUTED' WHERE id = '${dealId}'`);
  });

  // Yakuniy bo'lmagan holat o'zgarishi TO'SILMASLIGI kerak
  await expectAccepted('FUNDED → SHIPPED o\'tishi to\'silmaydi', async (tx) => {
    const buyer = await makeUser(tx, 'b');
    const seller = await makeUser(tx, 's');
    const dealId = await makeDeal(tx, buyer, seller, 'FUNDED');
    await tx.$executeRawUnsafe(`UPDATE deals SET status = 'SHIPPED' WHERE id = '${dealId}'`);
  });

  console.log('\n─── DEALS: summa cheklovlari ───────────────────────────────\n');

  await expectRejected('Xaridor = sotuvchi bo\'lgan savdo rad etiladi', async (tx) => {
    const u = await makeUser(tx, 'x');
    await makeDeal(tx, u, u);
  });

  await expectRejected('Manfiy summali savdo rad etiladi', async (tx) => {
    const buyer = await makeUser(tx, 'b');
    const seller = await makeUser(tx, 's');
    await tx.$executeRawUnsafe(
      `INSERT INTO deals
         (id, buyer_id, seller_id, title, description, amount_tiyin, commission_tiyin,
          commission_bps, commission_payer, currency, status, version, created_at, updated_at)
       VALUES (gen_random_uuid(), '${buyer}', '${seller}', 't', '', -1000, 0,
               300, 'seller', 'UZS', 'DRAFT', 0, now(), now())`,
    );
  });

  await expectRejected('Komissiya summadan katta bo\'lsa rad etiladi', async (tx) => {
    const buyer = await makeUser(tx, 'b');
    const seller = await makeUser(tx, 's');
    await tx.$executeRawUnsafe(
      `INSERT INTO deals
         (id, buyer_id, seller_id, title, description, amount_tiyin, commission_tiyin,
          commission_bps, commission_payer, currency, status, version, created_at, updated_at)
       VALUES (gen_random_uuid(), '${buyer}', '${seller}', 't', '', 1000, 5000,
               300, 'seller', 'UZS', 'DRAFT', 0, now(), now())`,
    );
  });

  console.log('\n─── Natija ─────────────────────────────────────────────────\n');
  console.log(`  O'tdi: ${passed}   Yiqildi: ${failed}\n`);

  // Bazada tekshiruv qoldig'i qolmaganini isbotlash
  const leftovers = await prisma.$queryRaw<Array<{ users: bigint; deals: bigint; ledger: bigint }>>`
    SELECT (SELECT count(*) FROM users)          AS users,
           (SELECT count(*) FROM deals)          AS deals,
           (SELECT count(*) FROM ledger_entries) AS ledger
  `;
  const l = leftovers[0]!;
  console.log(`  Bazada qolgan: users=${l.users}, deals=${l.deals}, ledger_entries=${l.ledger}`);
  if (l.users !== 0n || l.deals !== 0n || l.ledger !== 0n) {
    console.log('  ⚠️  Tekshiruv ma\'lumotlari bazada qolib ketdi!');
  } else {
    console.log('  ✅ Hammasi ROLLBACK bo\'ldi, baza toza.\n');
  }

  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((err: unknown) => {
    console.error('\n  ❌ Tekshiruv bajarilmadi:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
