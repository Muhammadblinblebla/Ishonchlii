/**
 * Testlar ishga tushishidan OLDIN monorepo ildizidagi .env yuklanadi.
 *
 * `src/config/env.ts` import qilinganda darhol tekshiruv o'tkazadi va
 * xato bo'lsa `process.exit(1)` qiladi — shuning uchun .env undan oldin
 * yuklangan bo'lishi shart.
 *
 * FAYL BO'LMASA — jim o'tib ketamiz. CI'da `.env` YO'Q (u git'ga
 * tushmaydi), o'zgaruvchilar workflow'dan to'g'ridan-to'g'ri muhitga
 * beriladi. `loadEnvFile` mavjud bo'lmagan faylda ENOENT tashlaydi va
 * bu BARCHA testlarni boshlanmasdan yiqitardi.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envPath = fileURLToPath(new URL('../../../../.env', import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);

// Testlar `test` muhitida ishlaydi: logger o'chadi, rate limit sozlanadi.
process.env['NODE_ENV'] = 'test';
