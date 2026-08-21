import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'prisma/config';

// Monorepo ildizidagi yagona `.env` — har bir workspace uchun alohida
// nusxa saqlanmaydi, shunda sirlar ikki joyda ajralib ketmaydi.
//
// ⚠️ MAVJUDLIGI TEKSHIRILADI. Production'da (Docker, Railway) `.env` fayli
// YO'Q — o'zgaruvchilar muhitdan keladi. `process.loadEnvFile` mavjud
// bo'lmagan faylda ENOENT tashlaydi va butun build yiqiladi.
//
// Tashqi muhit har doim ustun: `DATABASE_URL` allaqachon o'rnatilgan
// bo'lsa faylga umuman tegilmaydi.
// ⚠️ IKKALA o'zgaruvchi ham tekshiriladi, faqat DATABASE_URL emas.
//
// `prisma.config.ts` mavjud bo'lsa Prisma CLI `.env` ni O'ZI YUKLAMAYDI
// ("Prisma config detected, skipping environment variable loading") —
// ya'ni yuklash butunlay shu fayl zimmasida.
//
// Sxema ikkita o'zgaruvchi so'raydi: `DATABASE_URL` va `DIRECT_URL`.
// Faqat birinchisi tekshirilsa, u muhitda bor-u ikkinchisi yo'q holatda
// `.env` o'tkazib yuborilardi va `migrate deploy` "Environment variable
// not found: DIRECT_URL" bilan yiqilardi.
if (!process.env['DATABASE_URL'] || !process.env['DIRECT_URL']) {
  const envPath = fileURLToPath(new URL('../../.env', import.meta.url));
  if (existsSync(envPath)) process.loadEnvFile(envPath);
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
});
