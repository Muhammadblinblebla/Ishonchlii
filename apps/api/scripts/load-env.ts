/**
 * Skriptlar uchun `.env` yuklovchi.
 *
 * CI'da muhit o'zgaruvchilari workflow'dan keladi, lokalda esa `.env` dan.
 * Skript ikkala holatda ham ishlashi kerak, aks holda `npm run ledger:check`
 * faqat CI'da ishlaydi va ishlab chiquvchi uni lokal sinab ko'ra olmaydi.
 *
 * Import qilinishi kifoya — yon ta'sir sifatida ishlaydi.
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

if (!process.env['DATABASE_URL']) {
  const envPath = fileURLToPath(new URL('../../../.env', import.meta.url));
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

if (!process.env['DATABASE_URL']) {
  console.error(
    '\n  ❌ DATABASE_URL topilmadi.\n' +
      '     Monorepo ildizida .env faylini yarating (.env.example dan nusxa oling).\n',
  );
  process.exit(1);
}
