/**
 * Testlar uchun umumiy yordamchilar.
 *
 * Testlar HAQIQIY bazaga tegadi (Supabase / CI'dagi Postgres). Mock emas —
 * chunki tekshirmoqchi bo'lgan narsalarimizning ko'pi aynan bazada:
 * triggerlar, unique cheklovlar, tranzaksiya izolyatsiyasi.
 */

import type { FastifyInstance } from 'fastify';
import { buildApp, type BuildAppOptions } from '../../src/app.js';
import { prisma } from '../../src/db/prisma.js';

/** Har bir test fayli o'z prefiksini ishlatadi — bir-biriga xalaqit bermaslik uchun. */
export const TEST_PREFIX = 'vitest-';

export async function makeApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = await buildApp(options);
  await app.ready();
  return app;
}

export function uniqueEmail(tag = 'user'): string {
  return `${TEST_PREFIX}${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
}

/**
 * Test ma'lumotlarini tozalaydi.
 *
 * FAQAT `vitest-` prefiksli foydalanuvchilarni o'chiradi — seed hisoblari
 * va haqiqiy ma'lumotlarga tegmaydi.
 *
 * `ledger_entries` va `deal_events` append-only, ular O'CHIRILMAYDI. Test
 * pul harakatini yozgan bo'lsa, u bazada qoladi — bu ataylab shunday:
 * `npm run ledger:check` shu yozuvlar ustidan muvozanatni tekshiradi.
 */
export async function cleanupTestUsers(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: TEST_PREFIX } },
    select: { id: true },
  });
  if (users.length === 0) return;

  const ids = users.map((u) => u.id);

  await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.idempotencyRecord.deleteMany({ where: { userId: { in: ids } } });

  // Savdosi bo'lmagan foydalanuvchilarnigina o'chiramiz. Savdosi borlarida
  // deal_events append-only bo'lgani uchun kaskad o'chirish ishlamaydi —
  // ular `deletedAt` bilan belgilanadi.
  const withDeals = await prisma.deal.findMany({
    where: { OR: [{ buyerId: { in: ids } }, { sellerId: { in: ids } }] },
    select: { buyerId: true, sellerId: true },
  });
  const busy = new Set(withDeals.flatMap((d) => [d.buyerId, d.sellerId]));

  const deletable = ids.filter((id) => !busy.has(id));
  if (deletable.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: deletable } } });
  }
  const softDeletable = ids.filter((id) => busy.has(id));
  if (softDeletable.length > 0) {
    await prisma.user.updateMany({
      where: { id: { in: softDeletable }, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }
}

export { prisma };
