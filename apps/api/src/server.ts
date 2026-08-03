import { buildApp } from './app.js';
import { env } from './config/env.js';
import { prisma } from './db/prisma.js';
import { startScheduler, stopScheduler } from './jobs/scheduler.js';

async function main(): Promise<void> {
  const app = await buildApp();

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`${signal} qabul qilindi, server to'xtatilmoqda...`);
    // Avval fon vazifalarini to'xtatamiz: yangi pul harakati boshlanmasin.
    stopScheduler();
    // Keyin yangi so'rovlarni to'xtatamiz, oxirida bazani yopamiz — teskarisi
    // bo'lsa, ishlab turgan tranzaksiya o'rtada uzilib qolardi.
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: env.API_PORT, host: env.API_HOST });

  // Fon vazifalari server tinglashni boshlagandan KEYIN ishga tushadi —
  // aks holda ular ko'tarilish paytida bazani band qilib qo'yardi.
  //
  // Testlarda ishga tushmaydi: ular savdolarni o'zicha o'zgartirib,
  // testlarning natijasini buzib yuborardi.
  if (!env.isTest) {
    startScheduler(app.log);
  }
}

main().catch((err: unknown) => {
  console.error('Server ishga tushmadi:', err);
  process.exit(1);
});
