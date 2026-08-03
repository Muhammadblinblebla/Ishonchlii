import { defineConfig } from 'prisma/config';

// Monorepo ildizidagi yagona .env fayli — har bir workspace uchun alohida
// nusxa saqlanmaydi, shunda sirlar ikki joyda ajralib ketmaydi.
process.loadEnvFile?.(new URL('../../.env', import.meta.url).pathname);

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
});
