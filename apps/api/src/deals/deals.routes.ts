import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  COMMISSION_POLICY,
  CONTENT_KINDS,
  DEAL_STATUSES,
  DEAL_TYPES,
  KEYWORD_RULES,
  parseTiyin,
  usesChat,
  usesContent,
} from '@escrowuz/shared';
import { prisma, serializeBigInt } from '../db/prisma.js';
import { ApiError } from '../lib/errors.js';
import { idempotencyGuard } from '../plugins/idempotency.plugin.js';
import * as deals from './deals.service.js';
import { executeTransition } from './transition.js';

// ─── Sxemalar ────────────────────────────────────────────────────────────────

/**
 * Summa SATR sifatida qabul qilinadi.
 *
 * JSON `number` 2^53 dan katta butun sonni aniq saqlay olmaydi — katta
 * summa jimgina buzilib ketishi mumkin. Satr esa hech qachon buzilmaydi.
 */
const amountSchema = z
  .union([z.string(), z.number()])
  .transform((v, ctx) => {
    try {
      return parseTiyin(v);
    } catch (err) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: err instanceof Error ? err.message : 'Summa noto\'g\'ri',
      });
      return z.NEVER;
    }
  });

const createDealSchema = z.object({
  title: z.string().trim().min(3, 'Sarlavha kamida 3 belgi').max(200),
  description: z.string().trim().max(5000).default(''),
  amountTiyin: amountSchema,
  commissionPayer: z.enum(['buyer', 'seller', 'split']).default(COMMISSION_POLICY.defaultPayer),
  // Ko'rsatilmasa jismoniy tovar — eski mijozlar ham ishlashda davom etadi.
  dealType: z.enum(DEAL_TYPES).default('PHYSICAL'),
  /**
   * KALIT SO'Z — xaridor savdoni shu orqali topadi.
   * Sotuvchi o'ylab topadi, xaridorning emaili so'ralmaydi.
   */
  keyword: z
    .string()
    .trim()
    .min(KEYWORD_RULES.minLength)
    .max(KEYWORD_RULES.maxLength)
    .regex(KEYWORD_RULES.pattern, KEYWORD_RULES.patternHint),
});

const keywordSchema = z.object({
  keyword: z
    .string()
    .trim()
    .min(KEYWORD_RULES.minLength)
    .max(KEYWORD_RULES.maxLength),
});

/** Raqamli mahsulot: havola, matn yoki fayl kaliti. */
const contentSchema = z.object({
  kind: z.enum(CONTENT_KINDS),
  value: z.string().trim().min(1, 'Qiymat bo\'sh bo\'lishi mumkin emas').max(5000),
  fileName: z.string().trim().max(300).optional(),
  fileSize: z.coerce.number().int().positive().optional(),
  fileMime: z.string().trim().max(120).optional(),
});

const shipSchema = z.object({
  carrier: z.string().trim().min(2, 'Yetkazuvchi nomi kerak').max(100),
  trackingNumber: z.string().trim().min(3, 'Trek-raqam kerak').max(100),
  note: z.string().trim().max(500).optional(),
});

const reasonSchema = z.object({
  reason: z.string().trim().min(10, 'Sabab kamida 10 belgi bo\'lishi kerak').max(2000),
});

const listQuerySchema = z.object({
  status: z.enum(DEAL_STATUSES).optional(),
  role: z.enum(['buyer', 'seller']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().uuid().optional(),
});

const versionSchema = z.object({
  expectedVersion: z.coerce.number().int().min(0).optional(),
});

// ─── Yordamchilar ────────────────────────────────────────────────────────────

/**
 * Sxema bo'yicha tekshiradi va TO'G'RI TIPLANGAN natijani qaytaradi.
 *
 * Tip parametri ATAYLAB `z.ZodType<Out>` shaklida — `T extends z.ZodTypeAny`
 * + `z.infer<T>` emas. Sababi: ikkinchi shakl TypeScript yoki zod versiyasi
 * o'zgarganda inference'ni yo'qotib, hamma maydonni `optional` qilib
 * qo'yadi. Natijada mahalliy kompyuterda build o'tadi, deploy'da esa
 * "Property 'title' is optional but required" degan xato chiqadi.
 *
 * Bu shaklda `Out` sxemadan TO'G'RIDAN-TO'G'RI olinadi va versiyaga
 * bog'liq emas.
 */
function parse<Out>(schema: z.ZodType<Out, z.ZodTypeDef, unknown>, data: unknown): Out {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw ApiError.badRequest(
      'Kiritilgan ma\'lumot noto\'g\'ri',
      result.error.flatten().fieldErrors,
    );
  }
  return result.data;
}

function ctxOf(req: FastifyRequest) {
  return {
    ipAddress: req.ip,
    expectedVersion: parse(versionSchema, req.body ?? {}).expectedVersion,
  };
}

// ─── Marshrutlar ─────────────────────────────────────────────────────────────

export const dealRoutes: FastifyPluginAsync = async (app) => {
  // Barcha savdo marshrutlari avtorizatsiya talab qiladi.
  // Bu hook marshrut darajasidagi `preHandler` dan OLDIN ishlaydi, shuning
  // uchun quyida `authenticate` ni takrorlash shart emas — takrorlansa
  // har so'rovda foydalanuvchi bazadan IKKI MARTA o'qilardi.
  app.addHook('preHandler', app.authenticate);

  const mutating = { preHandler: [idempotencyGuard] };

  // ── Yaratish va ro'yxat ───────────────────────────────────────────────────

  app.post('/deals', mutating, async (req, reply) => {
    const input = parse(createDealSchema, req.body);
    const deal = await deals.createDeal(req.user!.id, input);
    return reply.code(201).send(serializeBigInt({ deal }));
  });

  app.get('/deals', async (req, reply) => {
    const query = parse(listQuerySchema, req.query);
    const list = await deals.listDeals(req.user!.id, query);
    return reply.send(serializeBigInt({ deals: list, count: list.length }));
  });

  /** Savdo yaratishdan oldin summalarni ko'rsatish uchun. */
  app.get('/deals/preview', async (req, reply) => {
    const schema = z.object({
      amountTiyin: amountSchema,
      commissionPayer: z.enum(['buyer', 'seller', 'split']).default('seller'),
    });
    const { amountTiyin, commissionPayer } = parse(schema, req.query);
    return reply.send(serializeBigInt(deals.previewAmounts(amountTiyin, commissionPayer)));
  });

  app.get('/deals/:id', async (req, reply) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const detail = await deals.getDealDetail(id, req.user!.id, req.user!.role === 'admin');
    return reply.send(serializeBigInt(detail));
  });

  app.get('/deals/:id/events', async (req, reply) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    // Ruxsatni tekshiradi — begona savdoning tarixi ko'rinmasligi kerak
    await deals.getDealForUser(id, req.user!.id, req.user!.role === 'admin');

    const events = await prisma.dealEvent.findMany({
      where: { dealId: id },
      orderBy: { createdAt: 'asc' },
      include: { actor: { select: { fullName: true } } },
    });
    return reply.send(serializeBigInt({ events }));
  });

  // ── Holat o'zgartiruvchi amallar ──────────────────────────────────────────

  /**
   * KALIT SO'Z bo'yicha ochiq savdoni topish.
   *
   * Hech narsa band qilinmaydi — xaridor faqat nima sotib olayotganini
   * va qancha to'lashini ko'radi.
   */
  app.post('/deals/find', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { keyword } = parse(keywordSchema, req.body);
      const found = await deals.findByKeyword(keyword, req.user!.id);
      return reply.send(serializeBigInt(found));
    },
  );

  /**
   * Xaridor savdoni BAND QILADI va to'lovga o'tadi.
   *
   * Poyga holati bazada atomik `updateMany` bilan to'siladi — ikki xaridor
   * bir vaqtda bosса faqat bittasi o'tadi.
   */
  app.post('/deals/:id/claim', mutating, async (req, reply) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const deal = await deals.claimDeal(id, req.user!.id);
    return reply.send(serializeBigInt({ deal }));
  });

  app.post('/deals/:id/pay', { ...mutating, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
      const webBase = req.headers.origin ?? 'http://localhost:3000';
      const link = await deals.createPaymentLink(id, req.user!.id, webBase);
      return reply.send(serializeBigInt(link));
    },
  );

  /**
   * Sotuvchi tovarni topshiradi.
   *
   * Tananing shakli SAVDO TURIGA qarab tanlanadi — mijoz o'zi tanlamaydi.
   * Aks holda raqamli savdoga trek-raqam yuborib, xaridorni mahsulotsiz
   * qoldirib ketish mumkin bo'lardi.
   */
  app.post('/deals/:id/ship', mutating, async (req, reply) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const { deal: current } = await deals.getDealForUser(id, req.user!.id, false);

    // eFootball: chat orqali topshiriladi, hech narsa saqlanmaydi
    if (usesChat(current.dealType)) {
      const deal = await deals.markHandedOver(id, req.user!.id, ctxOf(req));
      return reply.send(serializeBigInt({ deal }));
    }

    // Raqamli mahsulot: havola, matn yoki fayl
    if (usesContent(current.dealType)) {
      const data = parse(contentSchema, req.body);
      const deal = await deals.handoverContent(id, req.user!.id, data, ctxOf(req));
      return reply.send(serializeBigInt({ deal }));
    }

    // Jismoniy tovar: trek-raqam
    const data = parse(shipSchema, req.body);
    const deal = await deals.shipDeal(id, req.user!.id, data, ctxOf(req));
    return reply.send(serializeBigInt({ deal }));
  });

  /**
   * Raqamli mahsulot — FAQAT xaridorga, faqat topshirilgandan keyin.
   *
   * Alohida endpoint: savdo sahifasi (`GET /deals/:id`) sotuvchi va nizoda
   * admin uchun ham ochiq, mahsulot esa faqat xaridorga tegishli.
   */
  app.get('/deals/:id/content', async (req, reply) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const result = await deals.readContent(id, req.user!.id);

    return reply
      .header('Cache-Control', 'no-store, no-cache, must-revalidate, private')
      .header('Pragma', 'no-cache')
      .send(serializeBigInt(result));
  });

  /**
   * "Oldim, hammasi joyida" — pul sotuvchiga o'tadi.
   *
   * Bu tizimning eng nozik endpointi: shu yerdan keyin pulni qaytarib
   * bo'lmaydi. Ikki marta bosilsa ham bir marta o'tadi — `executeTransition`
   * ichidagi qulf va ledger idempotentligi buni ta'minlaydi.
   *
   * Tasdiqlangach pul sotuvchining `holding` hisobiga tushadi va 30 soat
   * muzlatib turiladi (`WALLET_HOLD_HOURS`).
   */
  app.post('/deals/:id/confirm', mutating, async (req, reply) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const { role } = await deals.getDealForUser(id, req.user!.id, false);

    if (role !== 'buyer') {
      throw ApiError.forbidden('Faqat xaridor tasdiqlaydi');
    }

    const result = await executeTransition(id, 'confirm', {
      ...ctxOf(req),
      actorId: req.user!.id,
      actor: 'buyer',
    });
    return reply.send(serializeBigInt({ deal: result.deal }));
  });

  app.post('/deals/:id/cancel', mutating, async (req, reply) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const { deal, role } = await deals.getDealForUser(id, req.user!.id, false);

    if (role === 'admin') throw ApiError.forbidden('Admin savdoni bekor qila olmaydi');

    // FUNDED holatida sotuvchi "refund" qiladi (pul qaytadi),
    // undan oldin esa oddiy "cancel" (pul tushmagan).
    const action = deal.status === 'FUNDED' ? 'refund' : 'cancel';

    const result = await executeTransition(id, action, {
      ...ctxOf(req),
      actorId: req.user!.id,
      actor: role,
      reason: (req.body as { reason?: string } | undefined)?.reason,
    });
    return reply.send(serializeBigInt({ deal: result.deal }));
  });

  // ── Nizo ochish ───────────────────────────────────────────────────────────

  app.post('/deals/:id/dispute', mutating, async (req, reply) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const { reason } = parse(reasonSchema, req.body);
    const { deal, role } = await deals.getDealForUser(id, req.user!.id, false);

    if (role === 'admin') throw ApiError.forbidden('Admin nizo ocha olmaydi');

    // §7: SHIPPED dan keyin 7 kun ichida
    if (deal.status === 'SHIPPED' && deal.autoReleaseAt && deal.autoReleaseAt < new Date()) {
      throw ApiError.invalidTransition('Nizo ochish muddati o\'tib ketdi');
    }

    const result = await executeTransition(id, 'dispute', {
      ...ctxOf(req),
      actorId: req.user!.id,
      actor: role,
      reason,
    });

    // §7: ikkala tomonga 48 soat dalil yuklash muddati
    await prisma.dispute.create({
      data: {
        dealId: id,
        openedBy: req.user!.id,
        reason,
        status: 'awaiting_evidence',
        evidenceDueAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      },
    });

    return reply.code(201).send(serializeBigInt({ deal: result.deal }));
  });
};
