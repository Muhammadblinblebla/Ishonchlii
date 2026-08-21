/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  QO'LLAB-QUVVATLASH — foydalanuvchi tomoni                              ║
 * ║                                                                          ║
 * ║  Savdo chatidan FARQI:                                                  ║
 * ║   • u yerda ikki foydalanuvchi yozishadi, matn SHIFRLANADI              ║
 * ║     (akkaunt paroli o'tadi va biz ham o'qimasligimiz kerak)             ║
 * ║   • bu yerda foydalanuvchi PLATFORMAGA yozadi — admin o'qishi shart,     ║
 * ║     shuning uchun shifrlanmaydi                                         ║
 * ║                                                                          ║
 * ║  Rasm BRAUZERDA siqiladi (eni 1600px, JPEG). Server bunga ISHONMAYDI:   ║
 * ║  hajm ham, MIME ham qayta tekshiriladi.                                 ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  SUPPORT_MAX_IMAGE_BYTES,
  SUPPORT_ALLOWED_IMAGE_MIMES,
  SUPPORT_REQUEST_BODY_LIMIT,
  supportSubjects,
} from '@escrowuz/shared';
import { prisma } from '../db/prisma.js';
import { STANDARD_TX } from '../db/tx-options.js';
import { ApiError } from '../lib/errors.js';

const idSchema = z.object({ id: z.string().uuid() });

/**
 * Rasm `data:` URL ko'rinishida keladi.
 *
 * Nega multipart emas: rasm allaqachon brauzerda siqilgan va kichik.
 * `data:` URL oddiy JSON ichida ketadi — alohida yuklash endpointi,
 * vaqtinchalik fayl va tozalash vazifasi kerak bo'lmaydi.
 */
const imageSchema = z
  .object({
    dataUrl: z.string().max(Math.ceil(SUPPORT_MAX_IMAGE_BYTES * 1.4) + 200),
    fileName: z.string().trim().min(1).max(200),
  })
  .optional();

const createSchema = z.object({
  subject: z.string().trim().min(3, 'Mavzu kamida 3 belgi').max(200),
  body: z.string().trim().min(5, 'Xabar kamida 5 belgi').max(4000),
  dealId: z.string().uuid().optional(),
  image: imageSchema,
});

const replySchema = z.object({
  body: z.string().trim().min(1, 'Xabar bo\'sh bo\'lishi mumkin emas').max(4000),
  image: imageSchema,
});

export interface DecodedImage {
  /** Prisma `Bytes` aynan shu tipni kutadi (`ArrayBufferLike` emas). */
  readonly data: Uint8Array<ArrayBuffer>;
  readonly mime: string;
  readonly sizeBytes: number;
  readonly fileName: string;
}

/**
 * `data:image/jpeg;base64,...` ni tekshirib baytga o'giradi.
 *
 * MIME faylning O'ZIDAN emas, sarlavhadan olinadi — lekin ro'yxatga
 * solishtiriladi va hajm cheklanadi. Rasm hech qachon BAJARILMAYDI
 * (faqat `<img>` da ko'rsatiladi), shuning uchun bu yetarli.
 */
export function decodeImage(input: { dataUrl: string; fileName: string }): DecodedImage {
  const match = /^data:([a-z]+\/[a-z0-9.+-]+);base64,(.+)$/i.exec(input.dataUrl.trim());
  if (!match) {
    throw ApiError.badRequest('Rasm formati noto\'g\'ri');
  }

  const mime = match[1]!.toLowerCase();
  if (!(SUPPORT_ALLOWED_IMAGE_MIMES as readonly string[]).includes(mime)) {
    throw ApiError.badRequest(
      `Bu turdagi rasm qabul qilinmaydi (${mime}). Ruxsat: ${SUPPORT_ALLOWED_IMAGE_MIMES.join(', ')}`,
    );
  }

  let data: Buffer;
  try {
    data = Buffer.from(match[2]!, 'base64');
  } catch {
    throw ApiError.badRequest('Rasmni o\'qib bo\'lmadi');
  }

  if (data.byteLength === 0) throw ApiError.badRequest('Rasm bo\'sh');
  if (data.byteLength > SUPPORT_MAX_IMAGE_BYTES) {
    const mb = (SUPPORT_MAX_IMAGE_BYTES / 1024 / 1024).toFixed(1);
    throw ApiError.badRequest(`Rasm juda katta. Eng ko'pi: ${mb} MB`);
  }

  // Prisma `Bytes` uchun aniq `ArrayBuffer` ustidagi `Uint8Array` kutadi.
  // `Buffer` ning tipi `ArrayBufferLike` (SharedArrayBuffer ham bo'lishi
  // mumkin), shuning uchun yangi buferga nusxa olamiz.
  const bytes = new Uint8Array(new ArrayBuffer(data.byteLength));
  bytes.set(data);

  return {
    data: bytes,
    mime,
    sizeBytes: data.byteLength,
    fileName: input.fileName.slice(0, 200),
  };
}

/** Xabar + rasmni BITTA tranzaksiyada yozadi. */
async function addMessage(params: {
  ticketId: string;
  senderId: string | null;
  body: string;
  image?: DecodedImage | undefined;
  newStatus: 'open' | 'answered';
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const message = await tx.supportMessage.create({
      data: {
        ticketId: params.ticketId,
        senderId: params.senderId,
        body: params.body,
      },
    });

    if (params.image) {
      await tx.supportAttachment.create({
        data: {
          messageId: message.id,
          data: params.image.data,
          mime: params.image.mime,
          sizeBytes: params.image.sizeBytes,
          fileName: params.image.fileName,
        },
      });
    }

    await tx.supportTicket.update({
      where: { id: params.ticketId },
      data: { lastMessageAt: new Date(), status: params.newStatus },
    });
  }, STANDARD_TX);
}

export const supportRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  /** Tayyor mavzular — foydalanuvchi yozishni o'ylab o'tirmasin. */
  app.get('/support/subjects', async (_req, reply) => reply.send({ subjects: supportSubjects }));

  /** Foydalanuvchining murojaatlari. */
  app.get('/support/tickets', async (req, reply) => {
    const tickets = await prisma.supportTicket.findMany({
      where: { userId: req.user!.id },
      orderBy: { lastMessageAt: 'desc' },
      take: 50,
      select: {
        id: true,
        subject: true,
        status: true,
        dealId: true,
        lastMessageAt: true,
        createdAt: true,
        _count: { select: { messages: true } },
      },
    });
    return reply.send({ tickets });
  });

  app.post(
    '/support/tickets',
    {
      // Standart 1 MB YETMAYDI: 2 MB rasm base64'da ~2.7 MB bo'ladi va
      // so'rov "413 Payload Too Large" bilan rad etilardi — foydalanuvchi
      // esa sababini bilmasdi.
      bodyLimit: SUPPORT_REQUEST_BODY_LIMIT,
      config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
    },
    async (req, reply) => {
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) {
        throw ApiError.badRequest('Ma\'lumot noto\'g\'ri', parsed.error.flatten().fieldErrors);
      }
      const { subject, body, dealId, image } = parsed.data;

      // Savdo ko'rsatilgan bo'lsa — u HAQIQATAN shu odamniki ekanini
      // tekshiramiz. Aks holda begona savdo ID'sini yozib, admin
      // panelida boshqa odamning savdosini ko'rsatib qo'yish mumkin edi.
      if (dealId) {
        const deal = await prisma.deal.findUnique({
          where: { id: dealId },
          select: { buyerId: true, sellerId: true },
        });
        if (!deal || (deal.buyerId !== req.user!.id && deal.sellerId !== req.user!.id)) {
          throw ApiError.badRequest('Bunday savdo topilmadi');
        }
      }

      const decoded = image ? decodeImage(image) : undefined;

      const ticket = await prisma.supportTicket.create({
        data: {
          userId: req.user!.id,
          subject,
          ...(dealId ? { dealId } : {}),
        },
      });

      await addMessage({
        ticketId: ticket.id,
        senderId: req.user!.id,
        body,
        image: decoded,
        newStatus: 'open',
      });

      return reply.code(201).send({ ticket: { id: ticket.id, subject, status: 'open' } });
    },
  );

  /** Bitta murojaat — xabarlari bilan. */
  app.get('/support/tickets/:id', async (req, reply) => {
    const { id } = idSchema.parse(req.params);

    const ticket = await prisma.supportTicket.findUnique({
      where: { id },
      select: {
        id: true,
        subject: true,
        status: true,
        dealId: true,
        userId: true,
        createdAt: true,
        messages: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            senderId: true,
            body: true,
            createdAt: true,
            // Rasm BAYTLARI TANLANMAYDI — faqat bor-yo'qligi.
            // Aks holda har sahifa ochilganda megabaytlar tortilardi.
            attachment: { select: { id: true, fileName: true, mime: true, sizeBytes: true } },
          },
        },
      },
    });

    // Begona murojaat: 403 emas, 404 — mavjudligi ham oshkor qilinmaydi.
    if (!ticket || ticket.userId !== req.user!.id) {
      throw ApiError.notFound('Murojaat topilmadi');
    }

    return reply.send({
      ticket: {
        id: ticket.id,
        subject: ticket.subject,
        status: ticket.status,
        dealId: ticket.dealId,
        createdAt: ticket.createdAt,
        messages: ticket.messages.map((m) => ({
          id: m.id,
          fromAdmin: m.senderId === null,
          body: m.body,
          createdAt: m.createdAt,
          attachment: m.attachment,
        })),
      },
    });
  });

  app.post(
    '/support/tickets/:id/reply',
    {
      bodyLimit: SUPPORT_REQUEST_BODY_LIMIT,
      config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
    },
    async (req, reply) => {
      const { id } = idSchema.parse(req.params);
      const parsed = replySchema.safeParse(req.body);
      if (!parsed.success) {
        throw ApiError.badRequest('Ma\'lumot noto\'g\'ri', parsed.error.flatten().fieldErrors);
      }

      const ticket = await prisma.supportTicket.findUnique({
        where: { id },
        select: { userId: true, status: true },
      });
      if (!ticket || ticket.userId !== req.user!.id) {
        throw ApiError.notFound('Murojaat topilmadi');
      }
      if (ticket.status === 'closed') {
        throw ApiError.badRequest('Bu murojaat yopilgan. Yangi murojaat oching.');
      }

      const decoded = parsed.data.image ? decodeImage(parsed.data.image) : undefined;

      await addMessage({
        ticketId: id,
        senderId: req.user!.id,
        body: parsed.data.body,
        image: decoded,
        // Foydalanuvchi yozdi = admin javobini kutmoqda
        newStatus: 'open',
      });

      return reply.code(201).send({ ok: true });
    },
  );

  /**
   * Rasmni ko'rsatish.
   *
   * Ruxsat HAR SO'ROVDA tekshiriladi: rasm egasi yoki admin. Havolani
   * bilgan begona odam ocholmaydi.
   */
  app.get('/support/attachments/:id', async (req, reply) => {
    const { id } = idSchema.parse(req.params);

    const file = await prisma.supportAttachment.findUnique({
      where: { id },
      select: {
        data: true,
        mime: true,
        fileName: true,
        message: { select: { ticket: { select: { userId: true } } } },
      },
    });

    if (!file) throw ApiError.notFound('Rasm topilmadi');

    const isOwner = file.message.ticket.userId === req.user!.id;
    if (!isOwner && req.user!.role !== 'admin') {
      throw ApiError.notFound('Rasm topilmadi');
    }

    return reply
      .header('Content-Type', file.mime)
      .header('Content-Disposition', `inline; filename="${encodeURIComponent(file.fileName)}"`)
      // Rasm o'zgarmas — brauzer keshlasin. `private`: umumiy keshga tushmasin.
      .header('Cache-Control', 'private, max-age=86400, immutable')
      // Rasm sifatida kelgan HTML bajarilib ketmasin
      .header('X-Content-Type-Options', 'nosniff')
      .send(Buffer.from(file.data));
  });
};
