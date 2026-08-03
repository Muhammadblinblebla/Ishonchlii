/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  MOCK TO'LOV — FAQAT ISHLAB CHIQISH UCHUN                                ║
 * ║                                                                          ║
 * ║  Bu marshrutlar "xaridor pul to'ladi" holatini yasab beradi, ya'ni       ║
 * ║  haqiqiy pulsiz savdoni FUNDED qiladi.                                  ║
 * ║                                                                          ║
 * ║  UCH QAVATLI HIMOYA — production'da hech qanday holatda ochilmasin:     ║
 * ║   1. `PAYMENT_PROVIDER !== 'mock'` bo'lsa umuman ro'yxatdan o'tmaydi    ║
 * ║   2. `NODE_ENV === 'production'` bo'lsa ro'yxatdan o'tmaydi             ║
 * ║   3. Har bir so'rovda ikkalasi QAYTA tekshiriladi                       ║
 * ║                                                                          ║
 * ║  Sababi: bu endpoint ochiq qolsa, istalgan odam pulsiz savdolarni        ║
 * ║  "to'langan" qilib, sotuvchilardan tovar undirib ketardi.               ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { env } from '../config/env.js';
import { prisma, serializeBigInt } from '../db/prisma.js';
import { ApiError } from '../lib/errors.js';
import { getPaymentProvider } from '../payments/index.js';
import { MockPaymentProvider } from '../payments/mock.provider.js';
import { processPayment } from '../webhooks/webhooks.routes.js';

/** Har so'rovda qayta tekshiriladigan himoya. */
function assertMockAllowed(): MockPaymentProvider {
  if (env.isProd) {
    throw ApiError.notFound('Topilmadi');
  }
  const provider = getPaymentProvider();
  if (!(provider instanceof MockPaymentProvider)) {
    throw ApiError.notFound('Topilmadi');
  }
  return provider;
}

export const mockPayRoutes: FastifyPluginAsync = async (app) => {
  // 1-qavat: noto'g'ri sozlamada marshrutlar umuman yaratilmaydi
  if (env.isProd || env.PAYMENT_PROVIDER !== 'mock') {
    app.log.info('Mock to\'lov marshrutlari o\'chirilgan');
    return;
  }

  app.log.warn(
    '⚠️  MOCK TO\'LOV YOQILGAN: /dev/mock-pay orqali pulsiz to\'lov qilish mumkin. ' +
      'Bu faqat ishlab chiqish uchun.',
  );

  const paramsSchema = z.object({ invoiceId: z.string().min(1).max(200) });

  /** To'lov sahifasi uchun ma'lumot. */
  app.get('/dev/mock-pay/:invoiceId', async (req, reply) => {
    assertMockAllowed();
    const { invoiceId } = paramsSchema.parse(req.params);

    const invoice = await prisma.invoice.findFirst({
      where: { externalId: invoiceId },
      include: { deal: { select: { id: true, title: true, status: true } } },
    });
    if (!invoice) throw ApiError.notFound('Hisob-faktura topilmadi');

    return reply.send(
      serializeBigInt({
        invoiceId,
        amountTiyin: invoice.amountTiyin,
        paidAt: invoice.paidAt,
        deal: invoice.deal,
      }),
    );
  });

  /**
   * "To'ladim" tugmasi.
   *
   * Haqiqiy oqimni AYNAN takrorlaydi:
   *   1. Provayder tomonidagi holat "paid" ga o'zgaradi
   *   2. `processPayment` provayderdan TASDIQ so'raydi
   *   3. Summa mos kelsa — ledgerga yoziladi
   *
   * Ya'ni bu yerda "savdoni FUNDED qil" degan qisqa yo'l YO'Q — shunda
   * ishlab chiqishda sinaladigan kod production'dagi bilan bir xil bo'ladi.
   */
  app.post('/dev/mock-pay/:invoiceId', async (req, reply) => {
    const provider = assertMockAllowed();
    const { invoiceId } = paramsSchema.parse(req.params);

    const invoice = await prisma.invoice.findFirst({ where: { externalId: invoiceId } });
    if (!invoice) throw ApiError.notFound('Hisob-faktura topilmadi');

    const body = z
      .object({
        /** Ataylab boshqa summa to'lash — PAYMENT_MISMATCH ni sinash uchun. */
        amountTiyin: z.string().regex(/^\d+$/).optional(),
      })
      .parse(req.body ?? {});

    try {
      provider.simulatePayment(
        invoiceId,
        body.amountTiyin ? { amountTiyin: BigInt(body.amountTiyin) } : {},
      );
    } catch {
      // Server qayta ishga tushgan bo'lsa mock xotirasi bo'sh bo'ladi.
      throw ApiError.conflict(
        'Bu hisob-faktura server xotirasida yo\'q (server qayta ishga tushgan bo\'lsa kerak). ' +
          'Savdo sahifasiga qaytib "To\'lov qilish" ni qayta bosing.',
      );
    }

    await processPayment(invoiceId, req.ip);

    const deal = await prisma.deal.findUniqueOrThrow({ where: { id: invoice.dealId } });
    return reply.send(serializeBigInt({ ok: true, deal }));
  });
};
