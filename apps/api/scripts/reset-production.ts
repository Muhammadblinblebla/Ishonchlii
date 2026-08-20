/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  BAZANI TOZALASH — PRODUCTIONGA TOZA START                               ║
 * ║                                                                          ║
 * ║  Barcha ma'lumotni O'CHIRADI va sxemani migratsiyalardan qayta quradi.   ║
 * ║                                                                          ║
 * ║  NEGA ODDIY `DELETE` YETMAYDI:                                          ║
 * ║  `ledger_entries` va `deal_events` — append-only. Baza triggeri          ║
 * ║  ularni o'chirishni BLOKLAYDI (bu ataylab shunday: moliyaviy tarixni     ║
 * ║  hech kim, hatto ilova ham o'chira olmasligi kerak).                    ║
 * ║  Shuning uchun yagona yo'l — sxemani butunlay qayta qurish.             ║
 * ║                                                                          ║
 * ║  ⚠️  QAYTARIB BO'LMAYDI. Ishga tushirish uchun ataylab uzun bayroq       ║
 * ║      kerak, tasodifan bosib yuborilmasin.                               ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 *   npx tsx scripts/reset-production.ts --hammasini-ochirish
 */

import './load-env.js';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const CONFIRM_FLAG = '--hammasini-ochirish';
const apiDir = fileURLToPath(new URL('..', import.meta.url));

async function main(): Promise<void> {
  if (!process.argv.includes(CONFIRM_FLAG)) {
    console.error(
      '\n  ❌ Tasdiqlash bayrog\'i yo\'q.\n' +
        '\n  Bu buyruq BARCHA ma\'lumotni o\'chiradi va qaytarib bo\'lmaydi.\n' +
        `  Rostdan xohlasangiz:\n\n    npx tsx scripts/reset-production.ts ${CONFIRM_FLAG}\n`,
    );
    process.exitCode = 1;
    return;
  }

  // DDL uchun TO'G'RIDAN-TO'G'RI ulanish kerak: pgbouncer orqali
  // `DROP SCHEMA` va migratsiyalar ishlamaydi.
  const directUrl = process.env['DIRECT_URL'] ?? process.env['DATABASE_URL'];
  if (!directUrl) {
    throw new Error('DIRECT_URL ham, DATABASE_URL ham topilmadi');
  }

  const prisma = new PrismaClient({ datasources: { db: { url: directUrl } } });

  // ── Nima o'chirilayotganini ko'rsatamiz ─────────────────────────────────────
  console.log('\n  Hozirgi holat:');
  try {
    const counts = [
      ['foydalanuvchilar', await prisma.user.count()],
      ['savdolar', await prisma.deal.count()],
      ['ledger yozuvlari', await prisma.ledgerEntry.count()],
      ['hisob-fakturalar', await prisma.invoice.count()],
    ] as const;
    for (const [label, n] of counts) console.log(`    ${label.padEnd(20)} ${n}`);
  } catch {
    console.log('    (jadvallar hali yaratilmagan)');
  }

  // ── Sxemani qayta qurish ────────────────────────────────────────────────────
  console.log('\n  Sxema o\'chirilmoqda...');
  await prisma.$executeRawUnsafe('DROP SCHEMA IF EXISTS public CASCADE');
  await prisma.$executeRawUnsafe('CREATE SCHEMA public');
  // Supabase standart rollarига huquqni qaytaramiz — aks holda ilova
  // o'z jadvallariga ham kira olmaydi.
  for (const role of ['postgres', 'anon', 'authenticated', 'service_role', 'public']) {
    await prisma.$executeRawUnsafe(`GRANT ALL ON SCHEMA public TO ${role}`).catch(() => undefined);
  }
  await prisma.$disconnect();
  console.log('  ✓ Sxema tozalandi');

  // ── Migratsiyalar ───────────────────────────────────────────────────────────
  console.log('\n  Migratsiyalar qo\'llanmoqda...');
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], { cwd: apiDir, stdio: 'inherit' });

  console.log(
    '\n  ✅ Baza toza.\n' +
      '\n  Keyingi qadam — administrator hisobini yaratish:\n' +
      '    npm run db:seed\n' +
      '\n  Tekshirish:\n' +
      '    npm run db:verify      (baza himoyalari)\n' +
      '    npm run ledger:check   (pul muvozanati)\n',
  );
}

main().catch((err: unknown) => {
  console.error('\n  ❌ Xato:', err);
  process.exitCode = 1;
});
