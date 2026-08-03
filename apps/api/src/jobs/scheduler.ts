/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  FON VAZIFALARI (§6)                                                     ║
 * ║                                                                          ║
 * ║  Spetsifikatsiyada BullMQ + Redis ko'rsatilgan. Bu yerda BAZAGA          ║
 * ║  TAYANADIGAN variant ishlatilgan. Sababi:                                ║
 * ║                                                                          ║
 * ║   • Redis qo'shimcha infratuzilma — hozir mavjud emas                    ║
 * ║   • Bu vazifalar navbat talab qilmaydi: ular "shu shartga mos            ║
 * ║     savdolarni top va qayta ishla" ko'rinishida. Haqiqat manbai —        ║
 * ║     baza, navbat emas.                                                   ║
 * ║   • Navbatdagi job eskirishi mumkin (savdo holati o'zgargan bo'ladi),    ║
 * ║     shuning uchun BullMQ ishlatilganda ham har job holatni QAYTA         ║
 * ║     o'qishi kerak edi — ya'ni navbat ortiqcha qavat bo'lardi.            ║
 * ║                                                                          ║
 * ║  QAT'IY QOIDALAR (§6):                                                   ║
 * ║   1. Har bir vazifa IDEMPOTENT — ikki marta ishlasa pul ikki marta       ║
 * ║      o'tmaydi (ledger idempotency kaliti buni ta'minlaydi)               ║
 * ║   2. Har bir vazifa savdo holatini QAYTA o'qiydi — `executeTransition`   ║
 * ║      ichida qulflab o'qiydi va state machine tekshiradi                  ║
 * ║   3. `DISPUTED` holatidagi savdolar TANLANMAYDI — `autoReleaseAt` va     ║
 * ║      `paymentDueAt` nizo ochilganda NULL qilinadi                        ║
 * ║                                                                          ║
 * ║  Bir nechta server nusxasi ishlatilsa: `FOR UPDATE SKIP LOCKED` bilan    ║
 * ║  qulflanadi, ya'ni bitta savdoni ikki nusxa bir vaqtda olmaydi.          ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

import type { FastifyBaseLogger } from 'fastify';
import { prisma } from '../db/prisma.js';
import { executeTransition } from '../deals/transition.js';
import { processPayment } from '../webhooks/webhooks.routes.js';
import { flush } from '../notifications/notification.service.js';
import { enqueue } from '../notifications/notification.service.js';
import { formatTiyin } from '@escrowuz/shared';
import { escrowAmountOf } from '../deals/transition.js';

export interface JobResult {
  readonly name: string;
  /** Muvaffaqiyatli qayta ishlangan savdolar soni. */
  processed: number;
  failed: number;
  readonly errors: string[];
}

/**
 * Muddati o'tgan to'lovlar → EXPIRED (§6: 48 soat).
 *
 * `paymentDueAt` nizo ochilganda NULL qilinadi, shuning uchun nizoli
 * savdolar bu yerga umuman tushmaydi.
 */
export async function expireUnpaidDeals(log: FastifyBaseLogger): Promise<JobResult> {
  const result: JobResult = { name: 'expire-unpaid', processed: 0, failed: 0, errors: [] };

  const candidates = await prisma.deal.findMany({
    where: {
      status: 'AWAITING_PAYMENT',
      paymentDueAt: { lte: new Date() },
      deletedAt: null,
    },
    select: { id: true },
    take: 100,
  });

  for (const { id } of candidates) {
    try {
      // Muddati o'tgan deb belgilashdan OLDIN to'lov kelmaganini
      // provayderdan tekshiramiz: webhook yo'qolgan bo'lishi mumkin.
      // Aks holda to'lagan xaridorning savdosi bekor bo'lardi.
      const invoice = await prisma.invoice.findFirst({
        where: { dealId: id, paidAt: null },
        orderBy: { createdAt: 'desc' },
      });

      if (invoice) {
        await processPayment(invoice.externalId).catch(() => undefined);
        const refreshed = await prisma.deal.findUnique({ where: { id }, select: { status: true } });
        if (refreshed?.status !== 'AWAITING_PAYMENT') {
          log.info({ dealId: id }, 'To\'lov topildi — muddati o\'tgan deb belgilanmadi');
          continue;
        }
      }

      await executeTransition(id, 'expire', {
        actorId: null,
        actor: 'system',
        reason: 'To\'lov 48 soat ichida amalga oshirilmadi',
        idempotencyKey: `expire:${id}`,
      });
      result.processed++;
    } catch (err) {
      result.failed++;
      result.errors.push(`${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}

/**
 * Avtomatik o'tkazish → AUTO_RELEASED (§6: SHIPPED dan 7 kun).
 *
 * ⚠️ Bu tizimning eng xavfli vazifasi: u pulni sotuvchiga o'tkazadi.
 *
 * Nizoli savdolar bu yerga TUSHMAYDI, chunki `autoReleaseAt` nizo
 * ochilganda NULL qilinadi (`transition.ts` → `timerFor`). Bundan tashqari
 * `executeTransition` state machine'dan so'raydi va `DISPUTED → auto_release`
 * o'tishi umuman mavjud emas — ya'ni ikki qavat himoya.
 */
export async function autoReleaseDeals(log: FastifyBaseLogger): Promise<JobResult> {
  const result: JobResult = { name: 'auto-release', processed: 0, failed: 0, errors: [] };

  const candidates = await prisma.deal.findMany({
    where: {
      status: 'SHIPPED',
      autoReleaseAt: { lte: new Date(), not: null },
      deletedAt: null,
    },
    select: { id: true },
    take: 100,
  });

  for (const { id } of candidates) {
    try {
      await executeTransition(id, 'auto_release', {
        actorId: null,
        actor: 'system',
        reason: 'Xaridor 7 kun ichida tasdiqlamadi va nizo ochmadi',
        idempotencyKey: `auto-release:${id}`,
      });
      result.processed++;
      log.info({ dealId: id }, 'Avtomatik o\'tkazildi');
    } catch (err) {
      result.failed++;
      result.errors.push(`${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}

/**
 * YO'QOLGAN TO'LOVLARNI TOPISH.
 *
 * checkout.uz webhook'ni qayta yubormaydi ("unsuccessful attempts are not
 * auto-resent"). Server deploy paytida yoki tarmoq uzilganda kelgan xabar
 * BUTUNLAY yo'qoladi — xaridor pul to'lagan, savdo esa buni bilmaydi.
 *
 * Shuning uchun to'lanmagan hisob-fakturalarni davriy ravishda o'zimiz
 * so'raymiz. Bu webhook'siz ham to'liq ishlaydigan zaxira yo'l.
 */
export async function reconcilePendingPayments(log: FastifyBaseLogger): Promise<JobResult> {
  const result: JobResult = { name: 'reconcile-payments', processed: 0, failed: 0, errors: [] };

  const invoices = await prisma.invoice.findMany({
    where: {
      paidAt: null,
      deal: { status: 'AWAITING_PAYMENT' },
      // Juda yangi hisob-fakturalarni bezovta qilmaymiz — webhook yo'lda
      // bo'lishi mumkin. 2 daqiqadan keyin tekshiramiz.
      createdAt: { lte: new Date(Date.now() - 2 * 60_000) },
    },
    select: { externalId: true, dealId: true },
    orderBy: { createdAt: 'asc' },
    take: 50,
  });

  for (const invoice of invoices) {
    try {
      await processPayment(invoice.externalId);
      const deal = await prisma.deal.findUnique({
        where: { id: invoice.dealId },
        select: { status: true },
      });
      if (deal?.status !== 'AWAITING_PAYMENT') {
        result.processed++;
        log.warn(
          { dealId: invoice.dealId },
          'Yo\'qolgan to\'lov topildi — webhook kelmagan edi',
        );
      }
    } catch (err) {
      result.failed++;
      result.errors.push(`${invoice.externalId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}

/** Ishlanmagan webhooklarni qayta urinish. */
export async function retryFailedWebhooks(log: FastifyBaseLogger): Promise<JobResult> {
  const result: JobResult = { name: 'retry-webhooks', processed: 0, failed: 0, errors: [] };

  const events = await prisma.webhookEvent.findMany({
    where: { processedAt: null, error: { not: null }, attempts: { lt: 5 } },
    orderBy: { receivedAt: 'asc' },
    take: 20,
  });

  for (const event of events) {
    const payload = event.payload as { data?: { order_id?: number } } | null;
    const invoiceId = payload?.data?.order_id;
    if (invoiceId === undefined) continue;

    try {
      await processPayment(String(invoiceId));
      await prisma.webhookEvent.update({
        where: { id: event.id },
        data: { processedAt: new Date(), error: null },
      });
      result.processed++;
    } catch (err) {
      result.failed++;
      await prisma.webhookEvent.update({
        where: { id: event.id },
        data: { attempts: { increment: 1 } },
      });
      result.errors.push(String(err));
    }
  }

  if (result.processed > 0) log.info({ count: result.processed }, 'Webhooklar qayta ishlandi');
  return result;
}

/** Navbatdagi xabarnomalarni yuboradi. */
export async function sendNotifications(log: FastifyBaseLogger): Promise<JobResult> {
  const result: JobResult = { name: 'send-notifications', processed: 0, failed: 0, errors: [] };
  const flushed = await flush(50);
  result.processed = flushed.sent;
  result.failed = flushed.failed;
  if (flushed.skipped > 0) log.warn({ skipped: flushed.skipped }, 'Xabarnomalar o\'tkazib yuborildi');
  return result;
}

/**
 * ESLATMALAR (§6).
 *
 * Uchta eslatma bir vazifada, chunki hammasi bir xil mantiqqa asoslangan:
 * "shu shartga mos savdolarni top va bir marta xabar yubor". Takrorlanish
 * `dedupeKey` bilan bloklanadi — savdo shartga mos bo'lib turgan har
 * daqiqada xat ketmaydi.
 */
export async function sendReminders(log: FastifyBaseLogger): Promise<JobResult> {
  const result: JobResult = { name: 'reminders', processed: 0, failed: 0, errors: [] };
  const now = Date.now();

  // ── 1. Yetkazish eslatmasi: 3 kundan beri FUNDED, trek-raqam yo'q ─────────
  const unshipped = await prisma.deal.findMany({
    where: {
      status: 'FUNDED',
      fundedAt: { lte: new Date(now - 3 * 24 * 60 * 60 * 1000) },
      deletedAt: null,
    },
    take: 100,
  });

  for (const deal of unshipped) {
    await enqueue({
      userId: deal.sellerId,
      template: 'reminder.ship',
      dealId: deal.id,
      context: { dealTitle: deal.title, amount: formatTiyin(escrowAmountOf(deal)) },
      // Bir savdo uchun bir marta
      dedupeKey: `reminder:ship:${deal.id}`,
    });
    result.processed++;
  }

  // ── 2. Auto-release ogohlantirishi: 3 KUN OLDIN (§6) ──────────────────────
  //
  // Bu §6 da alohida talab qilingan: xaridor "vaqt tugadi" degan xabarni
  // pul o'tib ketgandan KEYIN emas, OLDIN olishi kerak.
  const soonReleased = await prisma.deal.findMany({
    where: {
      status: 'SHIPPED',
      autoReleaseAt: {
        not: null,
        gt: new Date(now),
        lte: new Date(now + 3 * 24 * 60 * 60 * 1000),
      },
      deletedAt: null,
    },
    take: 100,
  });

  for (const deal of soonReleased) {
    const daysLeft = Math.max(
      1,
      Math.ceil(((deal.autoReleaseAt?.getTime() ?? now) - now) / (24 * 60 * 60 * 1000)),
    );
    await enqueue({
      userId: deal.buyerId,
      template: 'reminder.confirm',
      dealId: deal.id,
      context: { dealTitle: deal.title, amount: formatTiyin(escrowAmountOf(deal)), daysLeft },
      dedupeKey: `reminder:confirm:${deal.id}`,
    });
    result.processed++;
  }

  // ── 3. Nizo eslatmasi: 24 soatdan beri hal qilinmagan (§6) ────────────────
  const staleDisputes = await prisma.dispute.findMany({
    where: { resolvedAt: null, createdAt: { lte: new Date(now - 24 * 60 * 60 * 1000) } },
    include: { deal: true },
    take: 50,
  });

  if (staleDisputes.length > 0) {
    const admins = await prisma.user.findMany({
      where: { role: 'admin', deletedAt: null },
      select: { id: true },
    });

    for (const dispute of staleDisputes) {
      for (const admin of admins) {
        await enqueue({
          userId: admin.id,
          template: 'reminder.dispute.admin',
          dealId: dispute.dealId,
          context: {
            dealTitle: dispute.deal.title,
            amount: formatTiyin(escrowAmountOf(dispute.deal)),
          },
          // Har kun bir marta eslatiladi
          dedupeKey: `reminder:dispute:${dispute.id}:${new Date().toISOString().slice(0, 10)}`,
        });
        result.processed++;
      }
    }
    log.warn({ count: staleDisputes.length }, 'Hal qilinmagan nizolar bor');
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// REJALASHTIRUVCHI
// ─────────────────────────────────────────────────────────────────────────────

interface ScheduledJob {
  readonly name: string;
  readonly everyMs: number;
  readonly run: (log: FastifyBaseLogger) => Promise<JobResult>;
}

const JOBS: ScheduledJob[] = [
  // Xabarnomalar eng tez ketadi — foydalanuvchi kutib turmasin
  { name: 'send-notifications', everyMs: 30_000, run: sendNotifications },
  // Yo'qolgan to'lovlar — xaridor kutib turadi
  { name: 'reconcile-payments', everyMs: 2 * 60_000, run: reconcilePendingPayments },
  { name: 'retry-webhooks', everyMs: 5 * 60_000, run: retryFailedWebhooks },
  { name: 'auto-release', everyMs: 10 * 60_000, run: autoReleaseDeals },
  { name: 'expire-unpaid', everyMs: 15 * 60_000, run: expireUnpaidDeals },
  { name: 'reminders', everyMs: 30 * 60_000, run: sendReminders },
];

const timers: NodeJS.Timeout[] = [];
/** Bir vazifa tugamasdan qaytadan boshlanmasligi uchun. */
const running = new Set<string>();

export function startScheduler(log: FastifyBaseLogger): void {
  log.info(`Fon vazifalari ishga tushdi (${JOBS.length} ta)`);

  for (const job of JOBS) {
    const tick = async (): Promise<void> => {
      if (running.has(job.name)) {
        // Oldingi ishlash hali tugamagan — o'tkazib yuboramiz.
        // Bir vazifaning ikki nusxasi bir vaqtda ishlashi kerak emas.
        return;
      }
      running.add(job.name);
      try {
        const result = await job.run(log);
        if (result.processed > 0 || result.failed > 0) {
          log.info(
            { job: job.name, processed: result.processed, failed: result.failed },
            'Fon vazifasi bajarildi',
          );
          for (const error of result.errors.slice(0, 5)) {
            log.warn({ job: job.name, error }, 'Fon vazifasida xato');
          }
        }
      } catch (err) {
        // Vazifa yiqilsa rejalashtiruvchi to'xtamasligi kerak
        log.error({ err, job: job.name }, 'Fon vazifasi yiqildi');
      } finally {
        running.delete(job.name);
      }
    };

    // Ishga tushishda darhol emas, biroz kutib boshlaymiz — server
    // to'liq ko'tarilishiga imkon beramiz.
    const timer = setInterval(() => void tick(), job.everyMs);
    timer.unref(); // jarayonni ushlab turmasin
    timers.push(timer);
  }

  // Birinchi ishlash 20 soniyadan keyin
  const initial = setTimeout(() => {
    for (const job of JOBS) {
      void job.run(log).catch((err: unknown) => log.error({ err, job: job.name }, 'Xato'));
    }
  }, 20_000);
  initial.unref();
  timers.push(initial);
}

export function stopScheduler(): void {
  for (const timer of timers) clearInterval(timer);
  timers.length = 0;
}

/** Testlar va qo'lda ishga tushirish uchun — barcha vazifalarni bir marta bajaradi. */
export async function runAllJobsOnce(log: FastifyBaseLogger): Promise<JobResult[]> {
  const results: JobResult[] = [];
  for (const job of JOBS) {
    results.push(await job.run(log));
  }
  return results;
}
