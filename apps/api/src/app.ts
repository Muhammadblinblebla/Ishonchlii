import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { env } from './config/env.js';
import { ApiError } from './lib/errors.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { authPlugin } from './plugins/auth.plugin.js';

export interface BuildAppOptions {
  /**
   * Rate limiting yoqilsinmi.
   *
   * Testlarda standart holatda O'CHIQ: `app.inject` barcha so'rovlarni bitta
   * IP'dan yuboradi, ya'ni 5/daqiqa chegarasi testlarning o'zini bloklab
   * qo'yardi. Chegaralarning HAQIQATAN ishlashi `rate-limit.test.ts` da
   * ataylab yoqilgan holda tekshiriladi.
   */
  rateLimiting?: boolean;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const rateLimiting = options.rateLimiting ?? !env.isTest;
  const app = Fastify({
    logger: env.isTest
      ? false
      : {
          level: env.isProd ? 'info' : 'debug',
          // §11: loglarda parol, token, karta raqami HECH QACHON chiqmasin.
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.body.password',
              'req.body.refreshToken',
              'req.body.destination',
              'res.headers["set-cookie"]',
            ],
            censor: '[YASHIRILDI]',
          },
        },
    // Supabase pooler orqasida turadigan reverse-proxy uchun
    trustProxy: true,
    bodyLimit: 1_048_576, // 1 MB — fayl yuklash alohida yo'l orqali ketadi
  });

  await app.register(helmet, { contentSecurityPolicy: false });

  await app.register(cors, {
    // §11: faqat ma'lum domenlar. `*` ishlatilmaydi.
    origin: env.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
  });

  if (rateLimiting) {
    await app.register(rateLimit, {
      global: false, // har bir marshrut o'z chegarasini belgilaydi
      max: 100,
      timeWindow: '1 minute',
      keyGenerator: (req) => req.ip,
    });
  }

  await app.register(authPlugin);

  app.get('/health', async () => ({ status: 'ok', time: new Date().toISOString() }));

  await app.register(authRoutes);

  // ── Xatolarni yagona joyda qayta ishlash ──────────────────────────────────
  //
  // `err` ataylab `unknown`: bu yerga Fastify xatosi ham, Prisma xatosi ham,
  // kutubxona tashlagan har qanday narsa ham kelishi mumkin. Uni Error deb
  // faraz qilish — 500 o'rniga handlerning o'zi yiqilishiga olib keladi.
  app.setErrorHandler((err: unknown, req, reply) => {
    if (err instanceof ApiError) {
      return reply.code(err.statusCode).send({
        error: { code: err.code, message: err.message, details: err.details },
      });
    }

    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Kiritilgan ma\'lumot noto\'g\'ri',
          details: err.flatten().fieldErrors,
        },
      });
    }

    const statusCode =
      typeof err === 'object' && err !== null && 'statusCode' in err &&
      typeof (err as { statusCode: unknown }).statusCode === 'number'
        ? (err as { statusCode: number }).statusCode
        : undefined;

    if (statusCode === 429) {
      return reply.code(429).send({
        error: {
          code: 'RATE_LIMITED',
          message: 'Juda ko\'p so\'rov yuborildi. Biroz kutib qayta urinib ko\'ring.',
        },
      });
    }

    if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: err instanceof Error ? err.message : 'So\'rov noto\'g\'ri',
        },
      });
    }

    // Kutilmagan xato: to'liq tafsilot LOGGA, foydalanuvchiga umumiy xabar.
    // Ichki tafsilot (SQL matni, fayl yo'llari) tashqariga chiqmasligi kerak.
    req.log.error({ err }, 'Kutilmagan xato');
    return reply.code(500).send({
      error: { code: 'INTERNAL', message: 'Ichki xatolik yuz berdi' },
    });
  });

  app.setNotFoundHandler((_req, reply) =>
    reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Bunday manzil topilmadi' } }),
  );

  return app;
}
