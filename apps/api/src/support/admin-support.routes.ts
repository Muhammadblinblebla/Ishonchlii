/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ADMIN — murojaatlar va savdo chatlari                                   ║
 * ║                                                                          ║
 * ║  ⚠️ SAVDO CHATLARI HAQIDA MUHIM OGOHLANTIRISH                           ║
 * ║                                                                          ║
 * ║  eFootball chatidan AKKAUNT PAROLI o'tadi. U ataylab shifrlangan —      ║
 * ║  baza sizib chiqsa parollar oshkor bo'lmasin uchun. Lekin kalit         ║
 * ║  bizda, ya'ni admin uni OCHIB O'QIY OLADI.                              ║
 * ║                                                                          ║
 * ║  Shuning uchun har bir ochish `deal_events` ga YOZILADI — u             ║
 * ║  append-only va savdo tarixida IKKALA TOMONGA ko'rinadi. Admin          ║
 * ║  kimningdir yozishmasini bildirmasdan o'qiy olmaydi.                    ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma, serializeBigInt } from '../db/prisma.js';
import { STANDARD_TX } from '../db/tx-options.js';
import { ApiError } from '../lib/errors.js';
import { decryptSecret } from '../lib/crypto.js';

const idSchema = z.object({ id: z.string().uuid() });

const replySchema = z.object({
  body: z.string().trim().min(1, 'Javob bo\'sh bo\'lishi mumkin emas').max(4000),
});

export const adminSupportRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', async (req) => {
    if (req.user?.role !== 'admin') throw ApiError.notFound('Bunday manzil topilmadi');
  });

  // ── MUROJAATLAR ───────────────────────────────────────────────────────────

  /**
   * Navbat: javob kutayotganlar oldin, eng UZOQ kutgani eng yuqorida.
   *
   * `asc` ataylab: eng eski murojaat birinchi ko'rinadi. `desc` bo'lsa
   * yangi murojaatlar eskisini pastga surib, kimdir kunlab kutib qolardi.
   */
  app.get('/admin/support/tickets', async (req, reply) => {
    const { status } = z
      .object({ status: z.enum(['open', 'answered', 'closed', 'all']).default('open') })
      .parse(req.query);

    const tickets = await prisma.supportTicket.findMany({
      where: status === 'all' ? {} : { status },
      orderBy: status === 'open' ? { lastMessageAt: 'asc' } : { lastMessageAt: 'desc' },
      take: 100,
      select: {
        id: true,
        subject: true,
        status: true,
        dealId: true,
        lastMessageAt: true,
        createdAt: true,
        user: { select: { id: true, fullName: true, email: true } },
        _count: { select: { messages: true } },
      },
    });

    return reply.send({ tickets });
  });

  app.get('/admin/support/tickets/:id', async (req, reply) => {
    const { id } = idSchema.parse(req.params);

    const ticket = await prisma.supportTicket.findUnique({
      where: { id },
      select: {
        id: true,
        subject: true,
        status: true,
        createdAt: true,
        user: { select: { id: true, fullName: true, email: true, phone: true, createdAt: true } },
        deal: {
          select: {
            id: true,
            title: true,
            status: true,
            dealType: true,
            amountTiyin: true,
            keyword: true,
          },
        },
        messages: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            senderId: true,
            body: true,
            createdAt: true,
            // Baytlar TANLANMAYDI — faqat metama'lumot
            attachment: { select: { id: true, fileName: true, mime: true, sizeBytes: true } },
          },
        },
      },
    });

    if (!ticket) throw ApiError.notFound('Murojaat topilmadi');

    return reply.send(
      serializeBigInt({
        ticket: {
          ...ticket,
          messages: ticket.messages.map((m) => ({
            id: m.id,
            fromAdmin: m.senderId === null,
            body: m.body,
            createdAt: m.createdAt,
            attachment: m.attachment,
          })),
        },
      }),
    );
  });

  app.post('/admin/support/tickets/:id/reply', async (req, reply) => {
    const { id } = idSchema.parse(req.params);
    const parsed = replySchema.safeParse(req.body);
    if (!parsed.success) {
      throw ApiError.badRequest('Ma\'lumot noto\'g\'ri', parsed.error.flatten().fieldErrors);
    }

    const ticket = await prisma.supportTicket.findUnique({
      where: { id },
      select: { id: true, userId: true },
    });
    if (!ticket) throw ApiError.notFound('Murojaat topilmadi');

    await prisma.$transaction(async (tx) => {
      // `senderId: null` = admin. Aniq xodim ID'si saqlanmaydi:
      // foydalanuvchi uchun javob "qo'llab-quvvatlash xizmati" dan keladi.
      await tx.supportMessage.create({
        data: { ticketId: id, senderId: null, body: parsed.data.body },
      });
      await tx.supportTicket.update({
        where: { id },
        data: { status: 'answered', lastMessageAt: new Date() },
      });
    }, STANDARD_TX);

    // Foydalanuvchiga xabar — u saytga qaytib kelishini bilmaydi
    await prisma.notification
      .create({
        data: {
          userId: ticket.userId,
          type: 'support.replied',
          context: { subject: 'Murojaatingizga javob berildi' },
          dedupeKey: `support:${id}:${Date.now()}`,
        },
      })
      .catch(() => undefined);

    return reply.code(201).send({ ok: true });
  });

  app.post('/admin/support/tickets/:id/close', async (req, reply) => {
    const { id } = idSchema.parse(req.params);
    await prisma.supportTicket.update({
      where: { id },
      data: { status: 'closed', closedAt: new Date() },
    });
    return reply.send({ ok: true });
  });

  // ── SAVDO CHATLARI ────────────────────────────────────────────────────────

  /** Chat yozishmalari bo'lgan savdolar ro'yxati. */
  app.get('/admin/chats', async (_req, reply) => {
    const deals = await prisma.deal.findMany({
      where: { messages: { some: {} } },
      orderBy: { updatedAt: 'desc' },
      take: 100,
      select: {
        id: true,
        title: true,
        status: true,
        dealType: true,
        amountTiyin: true,
        updatedAt: true,
        buyer: { select: { id: true, fullName: true, email: true } },
        seller: { select: { id: true, fullName: true, email: true } },
        _count: { select: { messages: true } },
      },
    });

    return reply.send(serializeBigInt({ deals }));
  });

  /**
   * Bitta savdoning yozishmalari — OCHIQ MATNDA.
   *
   * Har bir ochish savdo tarixiga yoziladi. Bu ataylab: chatdan akkaunt
   * paroli o'tadi va uni kim, qachon o'qiganini tomonlar KO'RISHI kerak.
   */
  app.get('/admin/chats/:id', async (req, reply) => {
    const { id } = idSchema.parse(req.params);

    const deal = await prisma.deal.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        status: true,
        dealType: true,
        buyerId: true,
        sellerId: true,
        buyer: { select: { id: true, fullName: true, email: true } },
        seller: { select: { id: true, fullName: true, email: true } },
        messages: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            senderId: true,
            bodyCipher: true,
            createdAt: true,
            readAt: true,
          },
        },
      },
    });

    if (!deal) throw ApiError.notFound('Savdo topilmadi');

    // Ochilganini savdo tarixiga yozamiz — tomonlar ko'radi.
    await prisma.dealEvent
      .create({
        data: {
          dealId: id,
          actorId: req.user!.id,
          fromStatus: deal.status,
          toStatus: deal.status, // holat o'zgarmaydi
          action: 'admin.chat_viewed',
          reason: 'Administrator yozishmalarni ko\'rdi',
          ipAddress: req.ip,
        },
      })
      .catch(() => undefined);

    return reply.send({
      deal: {
        id: deal.id,
        title: deal.title,
        status: deal.status,
        dealType: deal.dealType,
        buyer: deal.buyer,
        seller: deal.seller,
      },
      messages: deal.messages.map((m) => {
        // Bitta buzilgan yozuv butun sahifani yiqitmasin
        let body: string;
        try {
          body = decryptSecret(m.bodyCipher);
        } catch {
          body = '[ochib bo\'lmadi — shifrlash kaliti o\'zgargan bo\'lishi mumkin]';
        }
        return {
          id: m.id,
          senderId: m.senderId,
          fromBuyer: m.senderId === deal.buyerId,
          body,
          createdAt: m.createdAt,
          readAt: m.readAt,
        };
      }),
    });
  });
};
