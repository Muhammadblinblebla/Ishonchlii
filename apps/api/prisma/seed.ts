/**
 * BOSHLANG'ICH MA'LUMOTLAR.
 *
 * Standart holatda FAQAT administrator hisobi yaratiladi — hech qanday
 * namunaviy foydalanuvchi, hech qanday soxta savdo.
 *
 * Demo foydalanuvchilar ATAYLAB so'ralganda qo'shiladi:
 *
 *     npm run db:seed -- --demo
 *
 * Nega shunday: avval demo foydalanuvchilar har seed'da yaratilardi va
 * ular productionga ham tushib ketishi mumkin edi. "aziz@example.uz"
 * parolini hamma biladi (`Test12345!`) — bunday hisob haqiqiy platformada
 * ochiq eshik degani.
 */

import '../scripts/load-env.js';
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();

// §11: argon2id, xotira-og'ir sozlamalar
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456, // 19 MiB — OWASP tavsiyasi
  timeCost: 2,
  parallelism: 1,
} as const;

const WANT_DEMO = process.argv.includes('--demo');

async function main(): Promise<void> {
  const isProd = process.env['NODE_ENV'] === 'production';

  if (isProd && WANT_DEMO) {
    throw new Error('Demo foydalanuvchilarni production muhitida yaratib bo\'lmaydi.');
  }

  const adminEmail = process.env['SEED_ADMIN_EMAIL'];
  const adminPassword = process.env['SEED_ADMIN_PASSWORD'];

  if (!adminEmail || !adminPassword) {
    throw new Error('.env faylida SEED_ADMIN_EMAIL va SEED_ADMIN_PASSWORD to\'ldirilmagan.');
  }
  if (adminPassword.length < 8) {
    throw new Error('SEED_ADMIN_PASSWORD kamida 8 belgidan iborat bo\'lishi kerak (§11).');
  }

  // Production'da zaif standart parol bilan admin ochilib qolmasin.
  const WEAK = ['Admin12345!', 'admin', 'password', '12345678'];
  if (isProd && WEAK.includes(adminPassword)) {
    throw new Error(
      'SEED_ADMIN_PASSWORD juda oddiy. Production uchun kuchli parol qo\'ying.',
    );
  }

  // `update: {}` — mavjud admin paroli QAYTA YOZILMAYDI. Aks holda har
  // deploy'da parol .env dagi qiymatga qaytib, admin o'zi o'zgartirgan
  // parolini yo'qotardi.
  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      fullName: 'Platforma administratori',
      passwordHash: await argon2.hash(adminPassword, ARGON2_OPTIONS),
      role: 'admin',
      isVerified: true,
    },
  });
  console.log(`  ✓ Admin: ${admin.email}`);

  if (!WANT_DEMO) {
    console.log('\n  Seed tugadi — faqat admin yaratildi.');
    console.log('  Demo foydalanuvchilar kerak bo\'lsa: npm run db:seed -- --demo\n');
    return;
  }

  // ── Demo foydalanuvchilar — faqat `--demo` bilan ───────────────────────────
  const demoPasswordHash = await argon2.hash('Test12345!', ARGON2_OPTIONS);

  for (const [email, fullName] of [
    ['aziz@example.uz', 'Aziz Karimov'],
    ['dilnoza@example.uz', 'Dilnoza Rahimova'],
  ] as const) {
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, fullName, passwordHash: demoPasswordHash, isVerified: true },
    });
    console.log(`  ✓ Demo foydalanuvchi: ${user.email}  (parol: Test12345!)`);
  }

  console.log('\n  ⚠️  Demo hisoblar yaratildi — productionga chiqarmang.\n');
}

main()
  .catch((err: unknown) => {
    console.error('\n  ❌ Seed xatosi:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
