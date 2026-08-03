/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  WEBHOOK QABUL QILISH                                                    ║
 * ║                                                                          ║
 * ║  Oqim (§5):                                                              ║
 * ║    1. Webhook keladi → `webhook_events` ga YOZILADI (xom holda)          ║
 * ║    2. Takroriy bo'lsa → 200 qaytariladi, hech narsa qilinmaydi           ║
 * ║    3. Provayderning O'ZIDAN so'raymiz (`confirmPayment`)                 ║
 * ║    4. Summa savdodagi bilan AYNAN mos kelsa → FUNDED                     ║
 * ║       Mos kelmasa → PAYMENT_MISMATCH, admin ko'radi                      ║
 * ║                                                                          ║
 * ║  Webhook'ning O'ZI hech narsani tasdiqlamaydi — checkout.uz unga imzo    ║
 * ║  qo'ymaydi. 3-qadam yagona ishonchli manba.                             ║
 * ║                                                                          ║
 * ║  Javob DOIM 200: provayder xato javobda webhook'ni qayta yubormaydi      ║
 * ║  ("unsuccessful attempts are not auto-resent"), ya'ni 500 qaytarsak      ║
 * ║  xabar butunlay yo'qoladi. Xatolar `webhook_events.error` ga yoziladi    ║
 * ║  va fon vazifasi ularni qayta ko'rib chiqadi.                            ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../db/prisma.js';
import { executeTransition } from '../deals/transition.js';
import { escrowAmountOf } from '../deals/transition.js';
import { getPaymentProvider } from '../payments/index.js';

export const webhookRoutes: FastifyPluginAsync = async (app) => {
  // Imzo tekshiruvi uchun XOM tana kerak — Fastify'ning JSON parseri
  // uni o'zgartirib yuborishi mumkin (probellar, maydonlar tartibi).
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req, body, done) => done(null, body),
  );

  app.post(
    '/webhooks/checkout-uz',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const provider = getPaymentProvider();
      const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);

      const headers: Record<string, string | undefined> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        headers[k.toLowerCase()] = Array.isArray(v) ? v[0] : v;
      }

      const parsed = provider.parseWebhook(rawBody, headers);

      if (!parsed.ok) {
        // O'qib bo'lmadi — qayd etib qo'yamiz, lekin 200 qaytaramiz.
        await prisma.webhookEvent
          .create({
            data: {
              provider: provider.name,
              externalId: `unparseable:${Date.now()}:${Math.random().toString(36).slice(2)}`,
              payload: { raw: rawBody.slice(0, 4000) },
              signatureValid: false,
              error: parsed.reason,
            },
          })
          .catch(() => undefined);

        req.log.warn({ reason: parsed.reason }, 'Webhook o\'qib bo\'lmadi');
        return reply.code(200).send({ received: true });
      }

      const { externalId, invoiceId } = parsed.parsed;

      // ── Idempotentlik: bir xil hodisa ikki marta ishlanmaydi (§12) ────────
      try {
        await prisma.webhookEvent.create({
          data: {
            provider: provider.name,
            externalId,
            payload: JSON.parse(rawBody) as object,
            signatureValid: provider.webhookIsSigned,
          },
        });
      } catch {
        // Unique buzilishi = bu hodisa allaqachon kelgan.
        req.log.info({ externalId }, 'Takroriy webhook — o\'tkazib yuborildi');
        return reply.code(200).send({ received: true, duplicate: true });
      }

      // ── Ishlov berish ─────────────────────────────────────────────────────
      try {
        await processPayment(invoiceId, req.ip);
        await prisma.webhookEvent.updateMany({
          where: { provider: provider.name, externalId },
          data: { processedAt: new Date() },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await prisma.webhookEvent.updateMany({
          where: { provider: provider.name, externalId },
          data: { error: message.slice(0, 1000), attempts: { increment: 1 } },
        });
        // 200 qaytaramiz — 500 bo'lsa provayder qayta yubormaydi va
        // to'lov haqidagi xabar butunlay yo'qoladi. Fon vazifasi qayta uradi.
        req.log.error({ err, invoiceId }, 'Webhook ishlov berishda xato');
      }

      return reply.code(200).send({ received: true });
    },
  );
};

/**
 * To'lovni provayderdan tasdiqlab, savdoni FUNDED qiladi.
 *
 * Fon vazifasi ham shu funksiyani chaqiradi (webhook yo'qolgan holat uchun),
 * shuning uchun u to'liq idempotent bo'lishi shart.
 */
export async function processPayment(invoiceId: string, ipAddress?: string): Promise<void> {
  const provider = getPaymentProvider();

  const invoice = await prisma.invoice.findFirst({
    where: { provider: provider.name, externalId: invoiceId },
    include: { deal: true },
  });

  if (!invoice) {
    throw new Error(`Hisob-faktura topilmadi: ${invoiceId}`);
  }
  if (invoice.paidAt) {
    return; // allaqachon ishlangan
  }

  // ── YAGONA ISHONCHLI MANBA ────────────────────────────────────────────────
  const status = await provider.confirmPayment(invoiceId);

  if (status.state === 'unavailable') {
    // Holat NOMA'LUM — hech narsa qilmaymiz. "To'lanmagan" deb hisoblash
    // to'langan savdoni bekor qilishga olib kelardi.
    throw new Error(`Provayderdan javob olinmadi: ${status.error}`);
  }
  if (status.state !== 'paid') {
    // Hali to'lanmagan yoki bekor qilingan — savdo o'z holatida qoladi.
    return;
  }

  const deal = invoice.deal;
  if (deal.status !== 'AWAITING_PAYMENT') {
    // Boshqa so'rov bizdan oldin ulgurgan yoki savdo bekor qilingan.
    return;
  }

  const expected = escrowAmountOf(deal);

  // ── §5: summa AYNAN mos kelishi shart ─────────────────────────────────────
  if (status.amountTiyin !== expected) {
    await executeTransition(deal.id, 'flag_mismatch', {
      actorId: null,
      actor: 'system',
      ipAddress,
      reason:
        `To'lov summasi mos kelmadi: kutilgan ${expected} tiyin, ` +
        `kelgan ${status.amountTiyin} tiyin`,
      metadata: {
        invoiceId,
        expectedTiyin: expected.toString(),
        receivedTiyin: status.amountTiyin.toString(),
      },
      idempotencyKey: `mismatch:${invoiceId}`,
    });

    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { paidAt: status.paidAt ?? new Date() },
    });
    return;
  }

  // ── To'lov to'g'ri — pul escrowga ─────────────────────────────────────────
  await executeTransition(deal.id, 'pay', {
    actorId: null,
    actor: 'system',
    ipAddress,
    metadata: { invoiceId, providerRef: status.providerRef },
    // Hisob-faktura ID'si — bir to'lov uchun bir xil, ya'ni webhook necha
    // marta kelsa ham ledgerga bir marta yoziladi.
    idempotencyKey: `deposit:${invoiceId}`,
  });

  await prisma.invoice.update({
    where: { id: invoice.id },
    data: { paidAt: status.paidAt ?? new Date() },
  });
}
