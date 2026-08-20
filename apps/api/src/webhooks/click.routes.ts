/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  CLICK CALLBACK — PREPARE / COMPLETE                                     ║
 * ║                                                                          ║
 * ║  Click to'lovni IKKI BOSQICHDA bajaradi va har ikkisida bizdan ANIQ      ║
 * ║  formatdagi javob kutadi. Javob noto'g'ri bo'lsa Click to'lovni bekor    ║
 * ║  qiladi — pul xaridorga qaytadi, savdo esa to'langan deb belgilanmaydi.  ║
 * ║                                                                          ║
 * ║    1. PREPARE  (action=0) — "shu buyurtma bormi, summa to'g'rimi?"      ║
 * ║       Bu paytda pul HALI YECHILMAGAN. Faqat tekshiramiz.                ║
 * ║                                                                          ║
 * ║    2. COMPLETE (action=1) — "pul yechildi (yoki yechilmadi)"            ║
 * ║       Ledgerga yozish AYNAN SHU YERDA bo'ladi.                          ║
 * ║                                                                          ║
 * ║  HAR IKKI SO'ROVDA BIRINCHI ISH — IMZONI TEKSHIRISH.                    ║
 * ║  Imzosiz so'rov — bu shunchaki HTTP so'rov: manzilni bilgan istalgan     ║
 * ║  odam "pul keldi" deb yuborib, pulsiz savdoni FUNDED qilib qo'yardi.    ║
 * ║                                                                          ║
 * ║  Javob HTTP kodi DOIM 200 — Click xato kodini javob TANASIDAN o'qiydi.  ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { prisma } from '../db/prisma.js';
import { executeTransition } from '../deals/transition.js';
import { getPaymentProvider } from '../payments/index.js';
import {
  CLICK_ACTION,
  CLICK_ERROR,
  ClickProvider,
  type ClickCallback,
} from '../payments/click.provider.js';

/** Click kutayotgan javob shakli. */
interface ClickReply {
  click_trans_id: string;
  merchant_trans_id: string;
  merchant_prepare_id?: string;
  merchant_confirm_id?: string;
  error: number;
  error_note: string;
}

const ERROR_NOTES: Record<number, string> = {
  [CLICK_ERROR.SUCCESS]: 'Success',
  [CLICK_ERROR.SIGN_CHECK_FAILED]: 'SIGN CHECK FAILED',
  [CLICK_ERROR.INCORRECT_AMOUNT]: 'Incorrect parameter amount',
  [CLICK_ERROR.ACTION_NOT_FOUND]: 'Action not found',
  [CLICK_ERROR.ALREADY_PAID]: 'Already paid',
  [CLICK_ERROR.TRANSACTION_NOT_FOUND]: 'Transaction does not exist',
  [CLICK_ERROR.FAILED_TO_UPDATE]: 'Failed to update user',
  [CLICK_ERROR.ERROR_IN_REQUEST]: 'Error in request from click',
  [CLICK_ERROR.TRANSACTION_CANCELLED]: 'Transaction cancelled',
};

function fail(cb: Partial<ClickCallback>, code: number): ClickReply {
  return {
    click_trans_id: cb.click_trans_id ?? '',
    merchant_trans_id: cb.merchant_trans_id ?? '',
    error: code,
    error_note: ERROR_NOTES[code] ?? 'Error',
  };
}

/**
 * Click ma'lumotni `application/x-www-form-urlencoded` yoki JSON bilan
 * yuborishi mumkin. Ikkalasini ham qabul qilamiz va barcha qiymatni
 * SATRGA o'giramiz — imzo hisoblashda tur muhim.
 */
function readCallback(req: FastifyRequest): ClickCallback {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const str = (key: string): string => {
    const v = body[key];
    return v === undefined || v === null ? '' : String(v);
  };

  return {
    click_trans_id: str('click_trans_id'),
    service_id: str('service_id'),
    click_paydoc_id: str('click_paydoc_id'),
    merchant_trans_id: str('merchant_trans_id'),
    merchant_prepare_id: str('merchant_prepare_id'),
    amount: str('amount'),
    action: str('action'),
    error: str('error'),
    error_note: str('error_note'),
    sign_time: str('sign_time'),
    sign_string: str('sign_string'),
  };
}

/** Har bir callback xom holda saqlanadi — nizo va tekshiruv uchun. */
async function record(
  externalId: string,
  cb: ClickCallback,
  signatureValid: boolean,
  error?: string,
): Promise<boolean> {
  try {
    await prisma.webhookEvent.create({
      data: {
        provider: 'click',
        externalId,
        payload: cb as unknown as object,
        signatureValid,
        ...(error ? { error } : {}),
      },
    });
    return true;
  } catch {
    // Unique buzilishi = bu hodisa allaqachon kelgan
    return false;
  }
}

export const clickRoutes: FastifyPluginAsync = async (app) => {
  /**
   * Click `application/x-www-form-urlencoded` yuboradi — Fastify buni
   * sukut bo'yicha o'qimaydi va 415 qaytaradi. 415 esa Click uchun
   * "xato" degani: to'lov bekor qilinadi.
   *
   * Parser SHU plagin ichida ro'yxatdan o'tadi (Fastify plaginlari
   * inkapsulyatsiyalangan), ya'ni boshqa marshrutlarga ta'sir qilmaydi.
   */
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_req, body, done) => {
      try {
        const params = new URLSearchParams(typeof body === 'string' ? body : String(body));
        const result: Record<string, string> = {};
        for (const [key, value] of params) result[key] = value;
        done(null, result);
      } catch (err) {
        done(err instanceof Error ? err : new Error('form-urlencoded o\'qib bo\'lmadi'), undefined);
      }
    },
  );

  const limits = { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } };

  /** Provayder haqiqatan Click ekanini tekshiradi. */
  function clickProvider(): ClickProvider | null {
    const provider = getPaymentProvider();
    return provider instanceof ClickProvider ? provider : null;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 1-BOSQICH: PREPARE — pul hali yechilmagan
  // ───────────────────────────────────────────────────────────────────────────
  app.post('/webhooks/click/prepare', limits, async (req, reply) => {
    const provider = clickProvider();
    const cb = readCallback(req);

    if (!provider) {
      req.log.warn('Click callback keldi, lekin Click provayderi yoqilmagan');
      return reply.code(200).send(fail(cb, CLICK_ERROR.ACTION_NOT_FOUND));
    }

    // ── Imzo — birinchi va eng muhim tekshiruv ───────────────────────────────
    if (!provider.verifySignature(cb)) {
      await record(`click:bad-sign:${cb.click_trans_id}:${Date.now()}`, cb, false, 'Imzo mos kelmadi');
      req.log.warn({ clickTransId: cb.click_trans_id }, 'Click: imzo NOTO\'G\'RI');
      return reply.code(200).send(fail(cb, CLICK_ERROR.SIGN_CHECK_FAILED));
    }

    if (cb.action !== String(CLICK_ACTION.PREPARE)) {
      return reply.code(200).send(fail(cb, CLICK_ERROR.ACTION_NOT_FOUND));
    }

    await record(`click:prepare:${cb.click_trans_id}`, cb, true);

    // ── Hisob-faktura mavjudmi ───────────────────────────────────────────────
    const invoice = await prisma.invoice.findFirst({
      where: { provider: 'click', externalId: cb.merchant_trans_id },
      include: { deal: true },
    });

    if (!invoice) {
      req.log.warn({ mti: cb.merchant_trans_id }, 'Click: hisob-faktura topilmadi');
      return reply.code(200).send(fail(cb, CLICK_ERROR.TRANSACTION_NOT_FOUND));
    }

    if (invoice.paidAt) {
      return reply.code(200).send(fail(cb, CLICK_ERROR.ALREADY_PAID));
    }

    // ── Savdo hali to'lov kutyaptimi ─────────────────────────────────────────
    //
    // Bekor qilingan yoki muddati o'tgan savdoga pul qabul qilib bo'lmaydi:
    // pul kelib qolsa uni qaytarish qo'shimcha qo'l mehnati bo'lardi.
    if (invoice.deal.status !== 'AWAITING_PAYMENT') {
      req.log.warn(
        { dealId: invoice.dealId, status: invoice.deal.status },
        'Click: savdo to\'lov kutmayapti',
      );
      return reply.code(200).send(fail(cb, CLICK_ERROR.TRANSACTION_CANCELLED));
    }

    // ── Summa AYNAN mos kelishi shart (§5) ───────────────────────────────────
    //
    // Prepare bosqichida rad etsak, pul umuman yechilmaydi. Complete'da
    // aniqlasak — pul allaqachon xaridorda yechilgan bo'ladi va uni
    // qaytarish kerak bo'lardi. Shuning uchun tekshiruv AYNAN SHU YERDA.
    let received: bigint;
    try {
      received = provider.fromSom(cb.amount);
    } catch {
      return reply.code(200).send(fail(cb, CLICK_ERROR.INCORRECT_AMOUNT));
    }

    if (received !== invoice.amountTiyin) {
      req.log.warn(
        { expected: invoice.amountTiyin.toString(), received: received.toString() },
        'Click: summa mos kelmadi',
      );
      return reply.code(200).send(fail(cb, CLICK_ERROR.INCORRECT_AMOUNT));
    }

    // ── Hammasi joyida ───────────────────────────────────────────────────────
    //
    // `merchant_prepare_id` — Complete bosqichida qaytib keladi va
    // imzoga kiradi. Hisob-faktura ID'sining o'zini beramiz.
    return reply.code(200).send({
      click_trans_id: cb.click_trans_id,
      merchant_trans_id: cb.merchant_trans_id,
      merchant_prepare_id: invoice.id,
      error: CLICK_ERROR.SUCCESS,
      error_note: ERROR_NOTES[CLICK_ERROR.SUCCESS]!,
    } satisfies ClickReply);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2-BOSQICH: COMPLETE — pul yechildi, ledgerga yoziladi
  // ───────────────────────────────────────────────────────────────────────────
  app.post('/webhooks/click/complete', limits, async (req, reply) => {
    const provider = clickProvider();
    const cb = readCallback(req);

    if (!provider) {
      return reply.code(200).send(fail(cb, CLICK_ERROR.ACTION_NOT_FOUND));
    }

    if (!provider.verifySignature(cb)) {
      await record(`click:bad-sign:${cb.click_trans_id}:${Date.now()}`, cb, false, 'Imzo mos kelmadi');
      req.log.warn({ clickTransId: cb.click_trans_id }, 'Click: Complete imzosi NOTO\'G\'RI');
      return reply.code(200).send(fail(cb, CLICK_ERROR.SIGN_CHECK_FAILED));
    }

    if (cb.action !== String(CLICK_ACTION.COMPLETE)) {
      return reply.code(200).send(fail(cb, CLICK_ERROR.ACTION_NOT_FOUND));
    }

    // ── Idempotentlik: bir xil Complete ikki marta ishlanmaydi ───────────────
    //
    // Click javobni olmasa so'rovni QAYTA yuboradi. Shusiz pul ikki marta
    // yozilib qolardi — tizimning eng qimmat xatosi.
    const first = await record(`click:complete:${cb.click_trans_id}`, cb, true);

    const invoice = await prisma.invoice.findFirst({
      where: { provider: 'click', externalId: cb.merchant_trans_id },
      include: { deal: true },
    });

    if (!invoice) {
      return reply.code(200).send(fail(cb, CLICK_ERROR.TRANSACTION_NOT_FOUND));
    }

    // Takroriy so'rov: allaqachon ishlangan — muvaffaqiyat deb javob
    // beramiz, lekin HECH NARSA qilmaymiz.
    if (!first || invoice.paidAt) {
      req.log.info({ clickTransId: cb.click_trans_id }, 'Click: takroriy Complete');
      return reply.code(200).send({
        click_trans_id: cb.click_trans_id,
        merchant_trans_id: cb.merchant_trans_id,
        merchant_confirm_id: invoice.id,
        error: CLICK_ERROR.SUCCESS,
        error_note: ERROR_NOTES[CLICK_ERROR.SUCCESS]!,
      } satisfies ClickReply);
    }

    // ── Click to'lov muvaffaqiyatsiz deb aytdimi ─────────────────────────────
    //
    // `error < 0` = pul yechilmadi. Savdo AWAITING_PAYMENT holatida qoladi,
    // xaridor qayta urinib ko'rishi mumkin.
    const clickError = Number(cb.error);
    if (Number.isFinite(clickError) && clickError < 0) {
      req.log.info(
        { clickTransId: cb.click_trans_id, error: clickError, note: cb.error_note },
        'Click: to\'lov bajarilmadi',
      );
      await prisma.webhookEvent.updateMany({
        where: { provider: 'click', externalId: `click:complete:${cb.click_trans_id}` },
        data: { processedAt: new Date(), error: `Click xatosi ${clickError}: ${cb.error_note}` },
      });
      return reply.code(200).send(fail(cb, CLICK_ERROR.TRANSACTION_CANCELLED));
    }

    if (invoice.deal.status !== 'AWAITING_PAYMENT') {
      return reply.code(200).send(fail(cb, CLICK_ERROR.TRANSACTION_CANCELLED));
    }

    // ── Summa qayta tekshiriladi ─────────────────────────────────────────────
    //
    // Prepare'da ham tekshirgan edik, lekin Complete'dagi summa boshqacha
    // bo'lishi mumkin. Pul yozishdan oldingi OXIRGI to'siq shu.
    let received: bigint;
    try {
      received = provider.fromSom(cb.amount);
    } catch {
      return reply.code(200).send(fail(cb, CLICK_ERROR.INCORRECT_AMOUNT));
    }

    // Solishtirish HISOB-FAKTURADAGI summa bilan, savdodan QAYTA
    // HISOBLANGANI bilan emas.
    //
    // Nega muhim: `chargedAmountOf(deal)` joriy komissiya siyosatidan
    // hisoblaydi. Agar hisob-faktura yaratilgandan keyin siyosat
    // o'zgargan bo'lsa (masalan provayder foizi 7.5% dan 0.5% ga),
    // qayta hisoblangan summa xaridor HAQIQATDA to'lagan summadan
    // farq qilardi — va mutlaqo to'g'ri to'lov PAYMENT_MISMATCH ga
    // tushib, admin qo'lda ko'rishini kutib qolardi.
    //
    // Hisob-fakturadagi summa — xaridorga ko'rsatilgan va provayderga
    // yuborilgan summa. Yagona to'g'ri mezon shu.
    const expected = invoice.amountTiyin;

    if (received !== expected) {
      // §5: farq bo'lsa savdo PAYMENT_MISMATCH ga o'tadi va admin ko'radi.
      // Pul Click'da qolgan — yo'qolmagan, lekin avtomatik yozilmaydi ham.
      await executeTransition(invoice.dealId, 'flag_mismatch', {
        actorId: null,
        actor: 'system',
        ipAddress: req.ip,
        reason:
          `Click to'lov summasi mos kelmadi: kutilgan ${expected} tiyin, ` +
          `kelgan ${received} tiyin`,
        metadata: {
          clickTransId: cb.click_trans_id,
          expectedTiyin: expected.toString(),
          receivedTiyin: received.toString(),
        },
        idempotencyKey: `mismatch:click:${cb.click_trans_id}`,
      });

      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { paidAt: new Date() },
      });

      return reply.code(200).send(fail(cb, CLICK_ERROR.INCORRECT_AMOUNT));
    }

    // ── Pul escrowga ─────────────────────────────────────────────────────────
    try {
      await executeTransition(invoice.dealId, 'pay', {
        actorId: null,
        actor: 'system',
        ipAddress: req.ip,
        metadata: {
          clickTransId: cb.click_trans_id,
          clickPaydocId: cb.click_paydoc_id,
          invoiceId: cb.merchant_trans_id,
        },
        // Click tranzaksiya ID'si bir to'lov uchun o'zgarmaydi — Complete
        // necha marta kelsa ham ledgerga bir marta yoziladi.
        idempotencyKey: `deposit:click:${cb.click_trans_id}`,
      });

      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { paidAt: new Date() },
      });

      await prisma.webhookEvent.updateMany({
        where: { provider: 'click', externalId: `click:complete:${cb.click_trans_id}` },
        data: { processedAt: new Date() },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      req.log.error({ err, dealId: invoice.dealId }, 'Click: pul yozishda xato');

      await prisma.webhookEvent.updateMany({
        where: { provider: 'click', externalId: `click:complete:${cb.click_trans_id}` },
        data: { error: message.slice(0, 1000), attempts: { increment: 1 } },
      });

      // Click'ga xato qaytaramiz — u qayta yuboradi va fon vazifasi ham
      // `reconcile-payments` orqali qayta uradi.
      return reply.code(200).send(fail(cb, CLICK_ERROR.FAILED_TO_UPDATE));
    }

    return reply.code(200).send({
      click_trans_id: cb.click_trans_id,
      merchant_trans_id: cb.merchant_trans_id,
      merchant_confirm_id: invoice.id,
      error: CLICK_ERROR.SUCCESS,
      error_note: ERROR_NOTES[CLICK_ERROR.SUCCESS]!,
    } satisfies ClickReply);
  });
};
