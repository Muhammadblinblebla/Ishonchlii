import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../db/prisma.js';
import { ApiError } from '../../lib/errors.js';
import { loginSchema, refreshSchema, registerSchema } from './auth.schemas.js';
import * as authService from './auth.service.js';
import type { AuthContext } from './auth.service.js';

function contextOf(req: { ip: string; headers: Record<string, unknown> }): AuthContext {
  const ua = req.headers['user-agent'];
  return {
    ipAddress: req.ip,
    userAgent: typeof ua === 'string' ? ua.slice(0, 500) : undefined,
  };
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  // §11: login 5/daqiqa
  const loginLimit = {
    rateLimit: { max: 5, timeWindow: '1 minute' },
  };
  // Ro'yxatdan o'tish ham cheklanadi — bo'lmasa bot yuzlab hisob ochib ketadi.
  const registerLimit = {
    rateLimit: { max: 5, timeWindow: '10 minutes' },
  };

  app.post('/auth/register', { config: registerLimit }, async (req, reply) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      throw ApiError.badRequest('Kiritilgan ma\'lumot noto\'g\'ri', parsed.error.flatten().fieldErrors);
    }
    const result = await authService.register(parsed.data, contextOf(req));
    return reply.code(201).send(result);
  });

  app.post('/auth/login', { config: loginLimit }, async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      // Login xatolarida qaysi maydon noto'g'ri ekanini batafsil aytmaymiz.
      throw ApiError.badRequest('Email yoki parol kiritilmagan');
    }
    const result = await authService.login(parsed.data, contextOf(req));
    return reply.send(result);
  });

  app.post('/auth/refresh', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = refreshSchema.safeParse(req.body);
    if (!parsed.success) {
      throw ApiError.badRequest('Refresh token kiritilmagan');
    }
    const result = await authService.refresh(parsed.data.refreshToken, contextOf(req));
    return reply.send(result);
  });

  app.post('/auth/logout', async (req, reply) => {
    const parsed = refreshSchema.safeParse(req.body);
    if (!parsed.success) {
      throw ApiError.badRequest('Refresh token kiritilmagan');
    }
    await authService.logout(parsed.data.refreshToken);
    // Token topilmasa ham 204 — mavjudligini oshkor qilmaymiz.
    return reply.code(204).send();
  });

  app.get('/auth/me', { preHandler: [app.authenticate] }, async (req, reply) => {
    // `authenticate` allaqachon bazadan o'qidi va foydalanuvchi borligini
    // tasdiqladi; bu yerda faqat to'liq profilni qaytaramiz.
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw ApiError.unauthorized('Hisob mavjud emas');
    return reply.send({ user: authService.toPublicUser(user) });
  });
};
