/**
 * Boshlang'ich ma'lumotlar — FAQAT development uchun.
 *
 * NODE_ENV=production bo'lsa ishga tushmaydi.
 * Admin paroli .env dagi SEED_ADMIN_PASSWORD dan olinadi, kodga yozilmaydi.
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

async function main(): Promise<void> {
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('Seed production muhitida ishga tushirilmaydi.');
  }

  const adminEmail = process.env['SEED_ADMIN_EMAIL'];
  const adminPassword = process.env['SEED_ADMIN_PASSWORD'];

  if (!adminEmail || !adminPassword) {
    throw new Error(
      '.env faylida SEED_ADMIN_EMAIL va SEED_ADMIN_PASSWORD to\'ldirilmagan.',
    );
  }
  if (adminPassword.length < 8) {
    throw new Error('SEED_ADMIN_PASSWORD kamida 8 belgidan iborat bo\'lishi kerak (§11).');
  }

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

  // Test foydalanuvchilari — ikkalasi ham xaridor va sotuvchi bo'la oladi (§2)
  const testPasswordHash = await argon2.hash('Test12345!', ARGON2_OPTIONS);

  for (const [email, fullName] of [
    ['aziz@example.uz', 'Aziz Karimov'],
    ['dilnoza@example.uz', 'Dilnoza Rahimova'],
  ] as const) {
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, fullName, passwordHash: testPasswordHash, isVerified: true },
    });
    console.log(`  ✓ Foydalanuvchi: ${user.email}  (parol: Test12345!)`);
  }

  console.log('\n  Seed tugadi.\n');
}

main()
  .catch((err: unknown) => {
    console.error('\n  ❌ Seed xatosi:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
