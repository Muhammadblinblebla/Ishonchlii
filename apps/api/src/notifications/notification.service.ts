/**
 * XABARNOMALARNI NAVBATGA QO'YISH VA YUBORISH.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  MUHIM: navbatga qo'yish ARZON bo'lishi shart.                          ║
 * ║                                                                          ║
 * ║  `enqueue` savdo tranzaksiyasi ICHIDA chaqiriladi. O'sha tranzaksiya     ║
 * ║  `Serializable` izolyatsiyada ishlaydi va savdo qatorini QULFLAB turadi. ║
 * ║  Har qo'shimcha so'rov qulfni uzoqroq ushlaydi.                         ║
 * ║                                                                          ║
 * ║  Shuning uchun `enqueue` FAQAT bitta `INSERT` qiladi. Foydalanuvchi      ║
 * ║  ismi va emaili, xabar matni — hammasi YUBORISH paytida, fon vazifasida  ║
 * ║  hal qilinadi.                                                          ║
 * ║                                                                          ║
 * ║  Avval bu yerda `user.findUnique` bor edi va har o'tishda 2–4 qo'shimcha ║
 * ║  so'rov qilinardi. Natijada tranzaksiyalar 20 soniyalik chegaraga urilib,║
 * ║  savdo o'tishlari yiqila boshladi.                                      ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

import type { Prisma } from '@prisma/client';
import {
  formatTiyin,
  renderEmail,
  type EmailContext,
  type EmailTemplate,
} from '@escrowuz/shared';
import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { getEmailDriver, type EmailMessage } from './email.js';

/** Xabar matnini qurish uchun kerakli ma'lumot (foydalanuvchi ismidan tashqari). */
export type NotificationContext = Omit<EmailContext, 'name'>;

export interface EnqueueParams {
  readonly userId: string;
  readonly template: EmailTemplate;
  readonly dealId?: string | undefined;
  readonly context: NotificationContext;
  /**
   * Takrorlanishni bloklaydigan kalit.
   *
   * Bir xil kalit bilan ikkinchi urinish hech narsa qilmaydi.
   */
  readonly dedupeKey: string;
}

/**
 * Xabarnomalarni navbatga qo'yadi — BITTA `INSERT` bilan.
 *
 * HECH QACHON `throw` qilmaydi: xabarnoma yubora olmaslik savdoni
 * to'xtatish uchun sabab emas. Pul harakati muhimroq.
 */
export async function enqueueMany(
  items: readonly EnqueueParams[],
  tx: Prisma.TransactionClient = prisma,
): Promise<void> {
  if (items.length === 0) return;

  try {
    await tx.notification.createMany({
      data: items.map((item) => ({
        userId: item.userId,
        dealId: item.dealId ?? null,
        type: item.template,
        channel: 'email',
        context: item.context as Prisma.InputJsonValue,
        dedupeKey: item.dedupeKey,
      })),
      // Takroriy kalit bo'lsa o'sha qatorni o'tkazib yuboradi, xato bermaydi
      skipDuplicates: true,
    });
  } catch (err) {
    // Xabarnoma savdoni to'xtatmasligi kerak. Lekin jim qolmaymiz.
    console.error('Xabarnomalarni navbatga qo\'yib bo\'lmadi:', err);
  }
}

export async function enqueue(
  params: EnqueueParams,
  tx: Prisma.TransactionClient = prisma,
): Promise<void> {
  await enqueueMany([params], tx);
}

// ─── Yuborish ────────────────────────────────────────────────────────────────

const MAX_ATTEMPTS = 5;

export interface FlushResult {
  sent: number;
  failed: number;
  skipped: number;
}

/**
 * Navbatdagi xabarnomalarni yuboradi. Fon vazifasi chaqiradi.
 *
 * Bu yerda tranzaksiya YO'Q — hech narsa qulflanmaydi, shuning uchun
 * qo'shimcha so'rovlar va sekin SMTP muammo tug'dirmaydi.
 */
export async function flush(limit = 50): Promise<FlushResult> {
  const result: FlushResult = { sent: 0, failed: 0, skipped: 0 };

  const pending = await prisma.notification.findMany({
    where: { status: 'pending', attempts: { lt: MAX_ATTEMPTS } },
    orderBy: { createdAt: 'asc' },
    take: limit,
    include: { user: { select: { email: true, fullName: true, deletedAt: true } } },
  });

  if (pending.length === 0) return result;

  const driver = getEmailDriver();

  for (const item of pending) {
    // Hisob o'chirilgan yoki manzil yaroqsiz — qayta urinish foydasiz
    if (item.user.deletedAt || !item.user.email.includes('@')) {
      await prisma.notification.update({
        where: { id: item.id },
        data: {
          status: 'skipped',
          error: item.user.deletedAt ? 'Hisob o\'chirilgan' : 'Email manzili noto\'g\'ri',
        },
      });
      result.skipped++;
      continue;
    }

    const message = buildMessage(item);
    const sendResult = await driver.send(message);

    if (sendResult.ok) {
      await prisma.notification.update({
        where: { id: item.id },
        data: {
          status: 'sent',
          sentAt: new Date(),
          error: null,
          // Audit izi: kimga, nima yuborilgani
          recipient: message.to,
          subject: message.subject,
          body: message.body,
        },
      });
      result.sent++;
      continue;
    }

    const attempts = item.attempts + 1;
    const giveUp = !sendResult.retryable || attempts >= MAX_ATTEMPTS;

    await prisma.notification.update({
      where: { id: item.id },
      data: {
        attempts,
        error: sendResult.error.slice(0, 500),
        ...(giveUp ? { status: 'failed' as const } : {}),
      },
    });
    result.failed++;
  }

  return result;
}

/** Saqlangan ma'lumotdan yuboriladigan xabarni quradi. */
function buildMessage(item: {
  type: string;
  dealId: string | null;
  context: unknown;
  user: { email: string; fullName: string };
}): EmailMessage {
  const context = (item.context ?? {}) as NotificationContext;

  const content = renderEmail(item.type as EmailTemplate, {
    ...context,
    // Ma'lumot yetishmasa ham xabar ketishi kerak — bo'sh joy qolmasin
    dealTitle: context.dealTitle ?? 'Savdo',
    amount: context.amount ?? '',
    name: item.user.fullName,
  });

  const webBase = env.corsOrigins[0] ?? 'http://localhost:3000';
  const url = item.dealId
    ? `${webBase}/deals/${item.dealId}`
    : item.type.startsWith('reminder.dispute')
      ? `${webBase}/admin/disputes`
      : `${webBase}/dashboard`;

  return {
    to: item.user.email,
    subject: content.subject,
    heading: content.heading,
    body: content.body,
    actionLabel: content.action,
    actionUrl: content.action ? url : null,
  };
}

/** Summani xabar uchun formatlaydi. */
export function amountFor(tiyin: bigint): string {
  return formatTiyin(tiyin);
}
