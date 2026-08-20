/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  CHAT — eFootball akkauntini topshirish uchun                            ║
 * ║                                                                          ║
 * ║  Uchta qat'iy qoida:                                                     ║
 * ║                                                                          ║
 * ║  1. TO'LOVDAN OLDIN CHAT YO'Q.                                          ║
 * ║     Aks holda tomonlar bu yerda kelishib, platformadan tashqarida        ║
 * ║     komissiyasiz savdo qilib ketishardi. Chat faqat pul escrowga         ║
 * ║     tushgandan keyin ochiladi.                                          ║
 * ║                                                                          ║
 * ║  2. XABAR MATNI SHIFRLANADI.                                            ║
 * ║     Akkaunt paroli aynan shu yerdan o'tadi. Baza nusxasida ochiq        ║
 * ║     yotmasligi kerak.                                                   ║
 * ║                                                                          ║
 * ║  3. XABARNI O'CHIRIB YOKI TAHRIRLAB BO'LMAYDI.                          ║
 * ║     Nizoda yozishmalar DALIL. Baza triggeri buni majburlaydi.           ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { chatOpenIn, usesChat } from '@escrowuz/shared';
import { prisma } from '../db/prisma.js';
import { ApiError } from '../lib/errors.js';
import { decryptSecret, encryptSecret } from '../lib/crypto.js';
import { getDealForUser } from './deals.service.js';

const idSchema = z.object({ id: z.string().uuid() });

const sendSchema = z.object({
  /**
   * `trim()` YO'Q: parolda ataylab qo'yilgan bo'sh joy bo'lishi mumkin
   * va uni kesib tashlasak xaridor akkauntga kira olmaydi.
   */
  body: z.string().min(1, 'Xabar bo\'sh bo\'lishi mumkin emas').max(4000),
});

export const chatRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  /**
   * Chat mavjudmi va foydalanuvchi unga kira oladimi.
   *
   * Admin faqat NIZO paytida ko'ra oladi — u ham dalil sifatida.
   * Oddiy savdoning yozishmalari admin uchun ham yopiq.
   */
  async function requireChat(dealId: string, userId: string, isAdmin: boolean) {
    const { deal, role } = await getDealForUser(dealId, userId, isAdmin);

    if (!usesChat(deal.dealType)) {
      throw ApiError.badRequest('Bu savdo turida chat ishlatilmaydi');
    }
    if (!chatOpenIn(deal.status)) {
      throw ApiError.forbidden(
        deal.status === 'DRAFT' || deal.status === 'AWAITING_PAYMENT'
          ? 'Chat to\'lovdan keyin ochiladi'
          : 'Chat yopilgan — savdo yakunlangan',
      );
    }
    if (role === 'admin' && deal.status !== 'DISPUTED') {
      throw ApiError.notFound('Savdo topilmadi');
    }

    return { deal, role };
  }

  // ── Xabarlarni o'qish ─────────────────────────────────────────────────────
  app.get('/deals/:id/messages', async (req, reply) => {
    const { id } = idSchema.parse(req.params);
    const { role } = await requireChat(id, req.user!.id, req.user!.role === 'admin');

    const rows = await prisma.message.findMany({
      where: { dealId: id },
      orderBy: { createdAt: 'asc' },
      take: 500,
      include: { sender: { select: { id: true, fullName: true } } },
    });

    const messages = rows.map((m) => ({
      id: m.id,
      senderId: m.senderId,
      senderName: m.sender.fullName,
      mine: m.senderId === req.user!.id,
      // Shifr ochilmasa xabarni butunlay yashirmaymiz — chat uzilib
      // qolgandan ko'ra, bitta xabar o'rniga ogohlantirish ko'rsatgan yaxshi.
      body: safeDecrypt(m.bodyCipher),
      createdAt: m.createdAt,
      readAt: m.readAt,
    }));

    // Qarshi tomon yozganlarini "o'qilgan" deb belgilaymiz.
    // Admin o'qigani hisoblanmaydi — u tomon emas.
    if (role !== 'admin') {
      await prisma.message.updateMany({
        where: { dealId: id, senderId: { not: req.user!.id }, readAt: null },
        data: { readAt: new Date() },
      });
    }

    return reply
      .header('Cache-Control', 'no-store, private')
      .send({ messages, count: messages.length });
  });

  // ── Xabar yuborish ────────────────────────────────────────────────────────
  app.post(
    '/deals/:id/messages',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { id } = idSchema.parse(req.params);
      const { role } = await requireChat(id, req.user!.id, false);

      if (role === 'admin') {
        throw ApiError.forbidden('Admin chatga yoza olmaydi');
      }

      const parsed = sendSchema.safeParse(req.body);
      if (!parsed.success) {
        throw ApiError.badRequest(
          'Xabar noto\'g\'ri',
          parsed.error.flatten().fieldErrors,
        );
      }

      const message = await prisma.message.create({
        data: {
          dealId: id,
          senderId: req.user!.id,
          bodyCipher: encryptSecret(parsed.data.body),
        },
      });

      return reply.code(201).send({
        id: message.id,
        senderId: message.senderId,
        mine: true,
        body: parsed.data.body,
        createdAt: message.createdAt,
        readAt: null,
      });
    },
  );
};

/**
 * Shifrni ochadi; ochilmasa o'rniga ogohlantirish qaytaradi.
 *
 * `CREDENTIALS_SECRET` almashtirilgan bo'lsa eski xabarlar ochilmaydi.
 * Bunday holda butun chat 500 xato berib yiqilishi noto'g'ri bo'lardi —
 * qolgan xabarlar va savdoning o'zi ishlashda davom etishi kerak.
 */
function safeDecrypt(cipher: string): string {
  try {
    return decryptSecret(cipher);
  } catch {
    return '[xabarni ochib bo\'lmadi — shifrlash kaliti o\'zgargan]';
  }
}
