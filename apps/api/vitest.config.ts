import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
    // .env ni har qanday modul import qilinishidan OLDIN yuklaydi
    setupFiles: ['./test/helpers/env.ts'],
    // Ulanishni BIR MARTA tekshiradi. Muammo bo'lsa testlar umuman
    // boshlanmaydi — o'nlab urinish pooler blokini keltirib chiqarmasligi uchun.
    globalSetup: ['./test/helpers/global-setup.ts'],
    // Pul bilan ishlaydigan testlar bir xil bazaga tegadi — parallel
    // ishlasa bir-birining yozuvlarini ko'radi. Ketma-ket bajariladi.
    fileParallelism: false,
    // Supabase ap-northeast-1 da — har so'rov ~200ms yo'l vaqti oladi,
    // Serializable tranzaksiya esa bir necha so'rovdan iborat.
    testTimeout: 90_000,
    hookTimeout: 90_000,
  },
  resolve: {
    alias: {
      // Testlar shared paketining MANBASINI o'qiydi, dist'ini emas —
      // shunda har o'zgarishdan keyin qayta build qilish shart emas.
      '@escrowuz/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
    },
  },
});
