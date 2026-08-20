/**
 * Testlar boshlanishidan OLDIN bir marta ishlaydi.
 *
 * Nega kerak: ulanish sozlamalari noto'g'ri bo'lsa, har bir test alohida
 * ulanishga urinadi. O'nlab muvaffaqiyatsiz autentifikatsiya esa Supabase
 * pooler'ining himoya mexanizmini (ECIRCUITBREAKER) ishga tushiradi va
 * ulanishlar BIR NECHA DAQIQAGA bloklanadi — hatto parol to'g'rilangandan
 * keyin ham.
 *
 * Shuning uchun bitta tekshiruv qilamiz va muammo bo'lsa darhol to'xtaymiz.
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function setup(): Promise<void> {
  // CI'da `.env` yo'q — o'zgaruvchilar muhitdan keladi. Qarang: helpers/env.ts
  const envPath = fileURLToPath(new URL('../../../../.env', import.meta.url));
  if (existsSync(envPath)) process.loadEnvFile(envPath);
  process.env['NODE_ENV'] = 'test';

  // Bazaga tegmaydigan testlarni (to'lov provayderi, sxema mosligi) baza
  // ishlamayotgan paytda ham ishga tushirish uchun:
  //   SKIP_DB_CHECK=1 npx vitest run test/payments.test.ts
  if (process.env['SKIP_DB_CHECK'] === '1') {
    console.log('\n  ⚠️  SKIP_DB_CHECK=1 — bazaga ulanish tekshirilmadi.');
    console.log('     Bazaga tegadigan testlar yiqiladi.\n');
    return;
  }

  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient({ log: [] });

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    console.error('\n╔════════════════════════════════════════════════════════════════╗');
    console.error('║  BAZAGA ULANIB BO\'LMADI — testlar ishga tushirilmadi           ║');
    console.error('╚════════════════════════════════════════════════════════════════╝\n');

    if (message.includes('ECIRCUITBREAKER')) {
      console.error('  Supabase pooler ulanishlarni VAQTINCHA bloklagan.');
      console.error('  Sabab: ketma-ket ko\'p marta noto\'g\'ri parol bilan urinilgan.\n');
      console.error('  Nima qilish kerak:');
      console.error('    1. .env dagi DATABASE_URL / DIRECT_URL parolini tekshiring');
      console.error('    2. Maxsus belgilar URL-encode qilinganini tasdiqlang');
      console.error('       (#→%23, @→%40, $→%24, /→%2F, ?→%3F, :→%3A)');
      console.error('    3. 5-10 daqiqa kuting — blok o\'zi tarqaydi\n');
    } else if (message.includes('P1000') || message.toLowerCase().includes('authentication')) {
      console.error('  Parol noto\'g\'ri.\n');
      console.error('  Supabase → Settings → Database → Reset database password');
      console.error('  Yangi parolni .env ga qo\'ying va maxsus belgilarni kodlang.\n');
      console.error('  MUHIM: testlarni qayta ishga tushirishdan oldin parolni to\'g\'rilang.');
      console.error('  Aks holda ko\'p urinish pooler blokini keltirib chiqaradi.\n');
    } else {
      console.error(`  ${message.split('\n')[0]}\n`);
    }

    await prisma.$disconnect();
    throw new Error('Bazaga ulanib bo\'lmadi — yuqoridagi ko\'rsatmaga qarang.');
  }

  await prisma.$disconnect();
}
