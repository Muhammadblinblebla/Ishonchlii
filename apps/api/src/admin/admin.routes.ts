/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ADMIN — NIZOLARNI HAL QILISH                                            ║
 * ║                                                                          ║
 * ║  §2: admin FAQAT nizo va to'lov nomuvofiqligi holatlariga aralashadi.    ║
 * ║  Boshqa savdolarni ko'ra ham, o'zgartira ham olmaydi — buni state        ║
 * ║  machine'dagi `actors` ro'yxati majburlaydi.                            ║
 * ║                                                                          ║
 * ║  Bu modul mavjud bo'lmasa, nizo ochilgan savdodagi pul MUZLAB QOLADI     ║
 * ║  va uni chiqarishning hech qanday yo'li bo'lmaydi.                       ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { computePaymentBreakdown, distributeSplit, refundRuleFor } from '@escrowuz/shared';
import { prisma, serializeBigInt } from '../db/prisma.js';
import { escrowAmountOf, executeTransition } from '../deals/transition.js';
import { ApiError } from '../lib/errors.js';
import { idempotencyGuard } from '../plugins/idempotency.plugin.js';
import * as ledger from '../ledger/ledger.service.js';
import { getPaymentProvider } from '../payments/index.js';

const resolveSchema = z
  .object({
    resolution: z.enum(['buyer', 'seller', 'split']),
    /**
     * `split` uchun: xaridor oladigan ulush FOIZDA (0–100).
     *
     * Admin foizda kiritadi, tizim ichkarida bazis punktga o'giradi —
     * shunda "60.5%" kabi qiymatlar ham aniq ifodalanadi.
     */
    buyerSharePercent: z.number().min(0).max(100).optional(),
    note: z
      .string()
      .trim()
      .min(20, 'Qaror sababi kamida 20 belgi bo\'lishi kerak — ikkala tomon buni o\'qiydi')
      .max(2000),
  })
  .refine((v) => v.resolution !== 'split' || v.buyerSharePercent !== undefined, {
    message: 'Bo\'lish uchun xaridor ulushi ko\'rsatilishi shart',
    path: ['buyerSharePercent'],
  });

export const adminRoutes: FastifyPluginAsync = async (app) => {
  // Barcha marshrutlar admin huquqini talab qiladi.
  // `requireAdmin` ichida `authenticate` chaqiriladi — quyida uni
  // takrorlamaymiz, aks holda har so'rovda baza 4 marta o'qilardi.
  app.addHook('preHandler', app.requireAdmin);

  // ── Nizolar ro'yxati ──────────────────────────────────────────────────────

  app.get('/admin/disputes', async (req, reply) => {
    const { status } = z
      .object({ status: z.enum(['open', 'resolved', 'all']).default('open') })
      .parse(req.query);

    const disputes = await prisma.dispute.findMany({
      where: status === 'all' ? {} : status === 'open' ? { resolvedAt: null } : { resolvedAt: { not: null } },
      orderBy: { createdAt: 'asc' }, // eng eskisi birinchi — kutib qolmasin
      include: {
        deal: { select: { id: true, title: true, status: true, amountTiyin: true, commissionPayer: true, commissionBps: true, commissionTiyin: true } },
        opener: { select: { id: true, fullName: true, email: true } },
        files: { select: { id: true, originalFilename: true, mimeType: true, sizeBytes: true } },
      },
    });

    return reply.send(serializeBigInt({ disputes, count: disputes.length }));
  });

  // ── Bitta nizo tafsiloti ──────────────────────────────────────────────────

  app.get('/admin/disputes/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    const dispute = await prisma.dispute.findUnique({
      where: { id },
      include: {
        deal: true,
        opener: { select: { id: true, fullName: true, email: true } },
        files: true,
      },
    });
    if (!dispute) throw ApiError.notFound('Nizo topilmadi');

    const [buyer, seller, events, shipments] = await Promise.all([
      prisma.user.findUnique({
        where: { id: dispute.deal.buyerId },
        select: { id: true, fullName: true, email: true },
      }),
      prisma.user.findUnique({
        where: { id: dispute.deal.sellerId },
        select: { id: true, fullName: true, email: true },
      }),
      prisma.dealEvent.findMany({
        where: { dealId: dispute.dealId },
        orderBy: { createdAt: 'asc' },
        include: { actor: { select: { fullName: true } } },
      }),
      prisma.shipment.findMany({ where: { dealId: dispute.dealId } }),
    ]);

    const escrowTiyin = escrowAmountOf(dispute.deal);

    return reply.send(
      serializeBigInt({
        dispute,
        buyer,
        seller,
        events,
        shipments,
        escrowTiyin,
        breakdown: computePaymentBreakdown(
          dispute.deal.amountTiyin,
          dispute.deal.commissionPayer,
          dispute.deal.commissionBps,
        ),
      }),
    );
  });

  /**
   * Qaror qabul qilishdan OLDIN pul qanday taqsimlanishini ko'rsatadi.
   *
   * Admin "60/40" deb yozganda aniq qancha so'm kimga ketishini ko'rishi
   * kerak — foizni tiyinga o'girishni uning xayolida qilishiga tashlab
   * qo'yish xato manbai bo'lardi.
   */
  app.get('/admin/disputes/:id/preview', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { buyerSharePercent } = z
      .object({ buyerSharePercent: z.coerce.number().min(0).max(100) })
      .parse(req.query);

    const dispute = await prisma.dispute.findUnique({ where: { id }, include: { deal: true } });
    if (!dispute) throw ApiError.notFound('Nizo topilmadi');

    const escrow = escrowAmountOf(dispute.deal);
    const takeCommission = refundRuleFor('RESOLVED_SPLIT') === 'take_commission';

    return reply.send(
      serializeBigInt({
        escrowTiyin: escrow,
        split: distributeSplit(
          escrow,
          Math.round(buyerSharePercent * 100), // foiz → bazis punkt
          dispute.deal.commissionTiyin,
          takeCommission,
        ),
      }),
    );
  });

  // ── Qaror ─────────────────────────────────────────────────────────────────

  app.post(
    '/admin/disputes/:id/resolve',
    { preHandler: [idempotencyGuard] },
    async (req, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

      const parsed = resolveSchema.safeParse(req.body);
      if (!parsed.success) {
        throw ApiError.badRequest('Ma\'lumot noto\'g\'ri', parsed.error.flatten().fieldErrors);
      }
      const { resolution, buyerSharePercent, note } = parsed.data;

      const dispute = await prisma.dispute.findUnique({ where: { id }, include: { deal: true } });
      if (!dispute) throw ApiError.notFound('Nizo topilmadi');
      if (dispute.resolvedAt) {
        throw ApiError.conflict('Bu nizo allaqachon hal qilingan');
      }

      const action =
        resolution === 'buyer'
          ? 'resolve_buyer'
          : resolution === 'seller'
            ? 'resolve_seller'
            : 'resolve_split';

      const buyerShareBps =
        buyerSharePercent === undefined ? undefined : Math.round(buyerSharePercent * 100);

      // Pul harakati va savdo holati — o'tish dvigateli orqali.
      // Nizo yozuvi esa alohida yangilanadi: u pul bilan bog'liq emas.
      const result = await executeTransition(dispute.dealId, action, {
        actorId: req.user!.id,
        actor: 'admin',
        ipAddress: req.ip,
        reason: note,
        ...(buyerShareBps === undefined ? {} : { buyerShareBps }),
        idempotencyKey: `dispute-resolve:${dispute.id}`,
      });

      await prisma.dispute.update({
        where: { id },
        data: {
          status: 'resolved',
          resolution,
          ...(buyerShareBps === undefined ? {} : { buyerShareBps }),
          resolutionNote: note,
          resolvedBy: req.user!.id,
          resolvedAt: new Date(),
        },
      });

      return reply.send(serializeBigInt({ deal: result.deal, resolution, note }));
    },
  );

  // ── To'lov nomuvofiqligi (§5) ─────────────────────────────────────────────

  app.get('/admin/payment-mismatches', async (_req, reply) => {
    const deals = await prisma.deal.findMany({
      where: { status: 'PAYMENT_MISMATCH' },
      orderBy: { updatedAt: 'asc' },
      include: {
        invoices: { orderBy: { createdAt: 'desc' }, take: 1 },
        events: { where: { toStatus: 'PAYMENT_MISMATCH' }, orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    return reply.send(serializeBigInt({ deals, count: deals.length }));
  });

  /**
   * Summa farqi bo'yicha qaror.
   *
   * `accept`  — farq tushuntirildi, savdo davom etadi (pul allaqachon escrowda)
   * `refund`  — kelgan pul jo'natuvchiga qaytariladi
   */
  app.post(
    '/admin/deals/:id/mismatch',
    { preHandler: [idempotencyGuard] },
    async (req, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const { decision, note } = z
        .object({
          decision: z.enum(['accept', 'refund']),
          note: z.string().trim().min(20, 'Sabab kamida 20 belgi').max(2000),
        })
        .parse(req.body);

      const result = await executeTransition(
        id,
        decision === 'accept' ? 'mismatch_accept' : 'mismatch_refund',
        {
          actorId: req.user!.id,
          actor: 'admin',
          ipAddress: req.ip,
          reason: note,
          idempotencyKey: `mismatch-resolve:${id}:${decision}`,
        },
      );

      return reply.send(serializeBigInt({ deal: result.deal }));
    },
  );

  // ── QO'LDA TO'LOV NAVBATI ─────────────────────────────────────────────────
  //
  // checkout.uz pul chiqarishni qo'llab-quvvatlamaydi, shuning uchun
  // sotuvchiga to'lov admin tomonidan bank orqali bajariladi.

  app.get('/admin/payouts', async (req, reply) => {
    const { status } = z
      .object({ status: z.enum(['pending', 'completed', 'failed', 'all']).default('pending') })
      .parse(req.query);

    const payouts = await prisma.payout.findMany({
      where: status === 'all' ? {} : { status },
      orderBy: { createdAt: 'asc' }, // eng eskisi birinchi
      include: { user: { select: { id: true, fullName: true, email: true, phone: true } } },
    });

    return reply.send(serializeBigInt({ payouts, count: payouts.length }));
  });

  /**
   * "O'tkazdim" — admin bank orqali pul yuborgach belgilaydi.
   *
   * DIQQAT: pul foydalanuvchi hisobidan yechish SO'RALGANDA yechilgan
   * (ledgerga o'shanda yozilgan). Bu yerda faqat holat yangilanadi —
   * qo'shimcha ledger yozuvi YO'Q, aks holda pul ikki marta chiqardi.
   */
  app.post(
    '/admin/payouts/:id/complete',
    { preHandler: [idempotencyGuard] },
    async (req, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const { reference } = z
        .object({
          reference: z
            .string()
            .trim()
            .min(3, 'O\'tkazma raqami yoki izoh kerak — keyin tekshirish uchun')
            .max(200),
        })
        .parse(req.body);

      const payout = await prisma.payout.findUnique({ where: { id } });
      if (!payout) throw ApiError.notFound('So\'rov topilmadi');
      if (payout.status === 'completed') {
        throw ApiError.conflict('Bu so\'rov allaqachon bajarilgan');
      }
      if (payout.status === 'failed') {
        throw ApiError.conflict('Bu so\'rov bekor qilingan — pul allaqachon qaytarilgan');
      }

      const updated = await prisma.payout.update({
        where: { id },
        data: { status: 'completed', providerRef: reference, processedAt: new Date() },
      });

      return reply.send(serializeBigInt({ payout: updated }));
    },
  );

  /**
   * "Bajara olmadim" — pul foydalanuvchi hisobiga QAYTARILADI.
   *
   * Bu yerda ledgerga teskari yozuv qo'shiladi, chunki pul so'rov
   * paytida hisobdan yechilgan edi.
   */
  app.post(
    '/admin/payouts/:id/reject',
    { preHandler: [idempotencyGuard] },
    async (req, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const { reason } = z
        .object({ reason: z.string().trim().min(10, 'Sabab kamida 10 belgi').max(500) })
        .parse(req.body);

      const payout = await prisma.payout.findUnique({ where: { id } });
      if (!payout) throw ApiError.notFound('So\'rov topilmadi');
      if (payout.status !== 'pending' && payout.status !== 'processing') {
        throw ApiError.conflict(`Bu so\'rov "${payout.status}" holatida — bekor qilib bo\'lmaydi`);
      }

      await prisma.$transaction(async (tx) => {
        await tx.payout.update({
          where: { id },
          data: { status: 'failed', failReason: reason, processedAt: new Date() },
        });
        // Pulni hisobga qaytaramiz
        await ledger.post(
          {
            legs: ledger.payoutReversalLegs(payout.userId, payout.amountTiyin, payout.provider),
            idempotencyKey: `payout-reversal:${payout.id}`,
          },
          tx,
        );
      });

      return reply.send({ ok: true });
    },
  );

  // ── Umumiy ko'rsatkichlar ─────────────────────────────────────────────────

  app.get('/admin/stats', async (_req, reply) => {
    const provider = getPaymentProvider();

    const [openDisputes, mismatches, activeDeals, escrow, pendingPayouts, providerBalance] =
      await Promise.all([
        prisma.dispute.count({ where: { resolvedAt: null } }),
        prisma.deal.count({ where: { status: 'PAYMENT_MISMATCH' } }),
        prisma.deal.count({ where: { status: { in: ['FUNDED', 'SHIPPED'] } } }),
        prisma.ledgerEntry.aggregate({
          where: { accountId: 'platform:escrow' },
          _sum: { amount: true },
        }),
        prisma.payout.aggregate({
          where: { status: { in: ['pending', 'processing'] } },
          _sum: { amountTiyin: true },
          _count: true,
        }),
        provider.getMerchantBalance(),
      ]);

    const escrowTiyin = escrow._sum.amount ?? 0n;

    // ── ESCROW HIMOYASI ──────────────────────────────────────────────────────
    //
    // Provayder balansi escrowdagi puldan KAM bo'lsa — platforma o'z
    // majburiyatini bajara olmaydi. Savdo bekor bo'lganda xaridorga
    // qaytarishga pul yetmaydi.
    //
    // Bu odatda bitta sababdan bo'ladi: platforma egasi checkout.uz
    // kabinetidan haddan ortiq pul yechib olgan.
    const shortfall =
      providerBalance !== null && providerBalance < escrowTiyin
        ? escrowTiyin - providerBalance
        : null;

    return reply.send(
      serializeBigInt({
        openDisputes,
        paymentMismatches: mismatches,
        activeDeals,
        escrowTiyin,
        pendingPayoutCount: pendingPayouts._count,
        pendingPayoutTiyin: pendingPayouts._sum.amountTiyin ?? 0n,
        providerBalanceTiyin: providerBalance,
        /** null bo'lmasa — DIQQAT: escrow majburiyati qoplanmagan. */
        shortfallTiyin: shortfall,
        payoutIsManual: !provider.supportsPayout,
      }),
    );
  });
};
