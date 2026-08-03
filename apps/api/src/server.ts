import { buildApp } from './app.js';
import { env } from './config/env.js';
import { prisma } from './db/prisma.js';

async function main(): Promise<void> {
  const app = await buildApp();

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`${signal} qabul qilindi, server to'xtatilmoqda...`);
    // Avval yangi so'rovlarni to'xtatamiz, keyin bazani yopamiz — teskarisi
    // bo'lsa, ishlab turgan tranzaksiya o'rtada uzilib qolardi.
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: env.API_PORT, host: env.API_HOST });
}

main().catch((err: unknown) => {
  console.error('Server ishga tushmadi:', err);
  process.exit(1);
});
