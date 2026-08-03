/**
 * Testlar ishga tushishidan OLDIN monorepo ildizidagi .env yuklanadi.
 *
 * `src/config/env.ts` import qilinganda darhol tekshiruv o'tkazadi va
 * xato bo'lsa `process.exit(1)` qiladi — shuning uchun .env undan oldin
 * yuklangan bo'lishi shart.
 */
import { fileURLToPath } from 'node:url';

process.loadEnvFile(fileURLToPath(new URL('../../../../.env', import.meta.url)));

// Testlar `test` muhitida ishlaydi: logger o'chadi, rate limit sozlanadi.
process.env['NODE_ENV'] = 'test';
