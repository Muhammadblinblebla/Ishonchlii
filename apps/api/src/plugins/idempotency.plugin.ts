/**
 * `Idempotency-Key` header qo'llab-quvvatlashi (§9).
 *
 * Tarmoq uzilib mijoz so'rovni qayta yuborsa, ikkinchi so'rov yangi pul
 * harakati YARATMAYDI — birinchisining javobi qaytariladi.
 *
 * Ikkita nozik holat qamrab olingan:
 *
 *  1. Bir xil kalit + BOSHQA tana → 422. Bu mijoz tomonidagi xato belgisi:
 *     kalitni qayta ishlatib boshqa amal bajarmoqchi bo'lishyapti. Jimgina
 *     eski javobni qaytarsak, mijoz amal bajarildi deb o'ylaydi.
 *
 *  2. Birinchi so'rov hali TUGAMAGAN (`completedAt` null) → 409. Ikkita
 *     bir xil so'rov bir vaqtda kelgan; ikkinchisi kutmaydi, "hozir
 *     ishlanmoqda" deb javob beradi.
 */

import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { prisma } from '../db/prisma.js';
import { ApiError } from '../lib/errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    idempotencyKey?: string;
  }
}

function hashBody(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex');
}

/**
 * Holat o'zgartiruvchi marshrutlarga `preHandler` sifatida qo'yiladi.
 *
 * `Idempotency-Key` berilmasa — o'tkazib yuboradi. Majburiy qilinmagan,
 * chunki UI'dan kelgan oddiy so'rovlar uchun ortiqcha yuk.
 */
export async function idempotencyGuard(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const key = req.headers['idempotency-key'];
  if (typeof key !== 'string' || key.trim() === '') return;

  if (key.length > 255) {
    throw ApiError.badRequest('Idempotency-Key juda uzun (maksimal 255 belgi)');
  }
  if (!req.user) {
    throw ApiError.unauthorized();
  }

  const endpoint = `${req.method} ${req.routeOptions.url ?? req.url}`;
  const requestHash = hashBody(req.body);

  const existing = await prisma.idempotencyRecord.findUnique({
    where: { userId_endpoint_key: { userId: req.user.id, endpoint, key } },
  });

  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw ApiError.idempotencyMismatch(
        'Bu Idempotency-Key boshqa so\'rov uchun ishlatilgan. Yangi kalit yarating.',
      );
    }
    if (!existing.completedAt) {
      throw ApiError.conflict('Bir xil so\'rov hozir ishlanmoqda. Biroz kutib qayta urining.');
    }
    // Takroriy so'rov — saqlangan javobni qaytaramiz, hech narsa bajarilmaydi.
    return reply
      .code(existing.statusCode ?? 200)
      .send(existing.responseBody ?? { replayed: true });
  }

  try {
    await prisma.idempotencyRecord.create({
      data: { userId: req.user.id, endpoint, key, requestHash },
    });
  } catch {
    // Unique buzilishi = boshqa so'rov bizdan oldin ulgurdi.
    throw ApiError.conflict('Bir xil so\'rov hozir ishlanmoqda. Biroz kutib qayta urining.');
  }

  req.idempotencyKey = key;
}

/** Javobni saqlaydi — keyingi takroriy so'rov shuni oladi. */
const plugin: FastifyPluginAsync = async (app) => {
  app.addHook('onSend', async (req, reply, payload) => {
    if (!req.idempotencyKey || !req.user) return payload;

    const endpoint = `${req.method} ${req.routeOptions.url ?? req.url}`;

    // Faqat muvaffaqiyatli javoblar saqlanadi. Xato javobni saqlasak,
    // mijoz muammoni tuzatib qayta yuborganda ham eski xatoni olardi.
    if (reply.statusCode >= 200 && reply.statusCode < 300) {
      let body: unknown = null;
      try {
        body = typeof payload === 'string' ? JSON.parse(payload) : null;
      } catch {
        body = null;
      }

      await prisma.idempotencyRecord.updateMany({
        where: { userId: req.user.id, endpoint, key: req.idempotencyKey },
        data: {
          statusCode: reply.statusCode,
          completedAt: new Date(),
          // `exactOptionalPropertyTypes` yoqilgani uchun maydonni butunlay
          // tushiramiz — `undefined` berish tip xatosi.
          ...(body === null ? {} : { responseBody: body as Prisma.InputJsonValue }),
        },
      });
    } else {
      // Xato bo'ldi — yozuvni o'chiramiz, kalit qayta ishlatilishi mumkin.
      await prisma.idempotencyRecord.deleteMany({
        where: { userId: req.user.id, endpoint, key: req.idempotencyKey },
      });
    }

    return payload;
  });
};

export const idempotencyPlugin = fp(plugin, { name: 'idempotency' });
