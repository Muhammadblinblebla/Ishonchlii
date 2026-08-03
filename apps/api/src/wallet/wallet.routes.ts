import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { parseTiyin, userAvailable, userPending } from '@escrowuz/shared';
import { prisma, serializeBigInt } from '../db/prisma.js';
import { ApiError } from '../lib/errors.js';
import * as ledger from '../ledger/ledger.service.js';
import { getPaymentProvider } from '../payments/index.js';
import { idempotencyGuard } from '../plugins/idempotency.plugin.js';

const payoutSchema = z.object({
  amountTiyin: z.union([z.string(), z.number()]).transform((v, ctx) => {
    try {
      return parseTiyin(v);
    } catch (err) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: err instanceof Error ? err.message : 'Summa noto\'g\'ri',
      });
      return z.NEVER;
    }
  }),
  destination: z.string().trim().min(4, 'Karta yoki hisob raqami kerak').max(64),
});

/** Karta raqamini maskalaydi — §11: loglarda va bazada to'liq raqam bo'lmasin. */
function maskDestination(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 8) return '*'.repeat(value.length);
  return `${digits.slice(0, 4)}${'*'.repeat(digits.length - 8)}${digits.slice(-4)}`;
}

export const walletRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  /** Balans — DOIM ledgerdan hisoblanadi (§4). */
  app.get('/wallet', async (req, reply) => {
    const balance = await ledger.getBalance(req.user!.id);
    return reply.send(
      serializeBigInt({
        availableTiyin: balance.availableTiyin,
        pendingTiyin: balance.pendingTiyin,
        totalTiyin: balance.availableTiyin + balance.pendingTiyin,
        currency: 'UZS',
      }),
    );
  });

  app.get('/wallet/transactions', async (req, reply) => {
    const { limit, cursor } = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(50),
        cursor: z.string().uuid().optional(),
      })
      .parse(req.query);

    const entries = await prisma.ledgerEntry.findMany({
      where: {
        accountId: { in: [userAvailable(req.user!.id), userPending(req.user!.id)] },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { deal: { select: { id: true, title: true, status: true } } },
    });

    return reply.send(serializeBigInt({ transactions: entries }));
  });

  /**
   * Pul yechish so'rovi.
   *
   * Ledger yozuvi va provayder chaqiruvi ALOHIDA qadamlar:
   * avval pul hisobdan yechiladi (tranzaksiya ichida, qulf bilan), keyin
   * provayderga yuboriladi. Provayder xato bersa — teskari yozuv qo'shiladi.
   *
   * Teskari tartib xavfli bo'lardi: provayderga yuborib, keyin ledgerga
   * yozishga ulgurmasak — pul chiqib ketgan, lekin hisobda qolgan bo'lardi.
   */
  app.post(
    '/wallet/payout',
    { preHandler: [idempotencyGuard], config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const parsed = payoutSchema.safeParse(req.body);
      if (!parsed.success) {
        throw ApiError.badRequest('Ma\'lumot noto\'g\'ri', parsed.error.flatten().fieldErrors);
      }
      const { amountTiyin, destination } = parsed.data;
      const userId = req.user!.id;

      const provider = getPaymentProvider();
      const idempotencyKey = req.idempotencyKey ?? `payout:${userId}:${Date.now()}`;

      // ── 1. Pulni hisobdan yechish (qulflangan holda) ──────────────────────
      const payout = await prisma.$transaction(
        async (tx) => {
          await ledger.assertSufficientFunds(userId, amountTiyin, tx);

          const record = await tx.payout.create({
            data: {
              userId,
              amountTiyin,
              destination: maskDestination(destination),
              provider: provider.name,
              status: 'processing',
              idempotencyKey,
            },
          });

          await ledger.post(
            {
              legs: ledger.payoutLegs(userId, amountTiyin, provider.name),
              idempotencyKey: `payout:${record.id}`,
            },
            tx,
          );

          return record;
        },
        { isolationLevel: 'Serializable', timeout: 20_000 },
      );

      // ── 2. Provayderga yuborish (tranzaksiyadan TASHQARIDA) ───────────────
      let result;
      try {
        result = await provider.payout({
          userId,
          amountTiyin,
          destination, // maskalanmagan — provayderga to'liq kerak
          idempotencyKey,
        });
      } catch (err) {
        result = {
          ok: false as const,
          error: err instanceof Error ? err.message : 'Noma\'lum xato',
          retryable: true,
        };
      }

      // ── 3. Natijaga qarab yakunlash ───────────────────────────────────────
      if (result.ok) {
        await prisma.payout.update({
          where: { id: payout.id },
          data: {
            status: result.status === 'completed' ? 'completed' : 'processing',
            providerRef: result.providerRef,
            processedAt: new Date(),
          },
        });
        return reply.send(serializeBigInt({ payout: { ...payout, status: result.status } }));
      }

      // Muvaffaqiyatsiz — pulni qaytaramiz
      await prisma.$transaction(async (tx) => {
        await tx.payout.update({
          where: { id: payout.id },
          data: { status: 'failed', failReason: result.error, processedAt: new Date() },
        });
        await ledger.post(
          {
            legs: ledger.payoutReversalLegs(userId, amountTiyin, provider.name),
            idempotencyKey: `payout-reversal:${payout.id}`,
          },
          tx,
        );
      });

      throw ApiError.conflict(
        `Pul yechib bo'lmadi: ${result.error}. Summa hisobingizga qaytarildi.`,
      );
    },
  );

  app.get('/wallet/payouts', async (req, reply) => {
    const payouts = await prisma.payout.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return reply.send(serializeBigInt({ payouts }));
  });
};
