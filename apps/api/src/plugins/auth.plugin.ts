import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { prisma } from '../db/prisma.js';
import { ApiError } from '../lib/errors.js';
import { verifyAccessToken } from '../lib/tokens.js';

export interface AuthUser {
  id: string;
  role: 'user' | 'admin';
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
  interface FastifyInstance {
    /** Har qanday tizimga kirgan foydalanuvchi. */
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Faqat admin (§2: admin boshqa savdolarga tegolmaydi). */
    requireAdmin: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

function extractBearer(req: FastifyRequest): string {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw ApiError.unauthorized('Authorization header topilmadi');
  }
  const token = header.slice(7).trim();
  if (!token) throw ApiError.unauthorized('Token bo\'sh');
  return token;
}

const plugin: FastifyPluginAsync = async (app) => {
  app.decorate('authenticate', async (req: FastifyRequest) => {
    const payload = await verifyAccessToken(extractBearer(req));

    // Token amal qilsa ham, foydalanuvchi o'chirilgan bo'lishi mumkin.
    // Access token 15 daqiqa yashaydi — bu oyna ochiq qolmasligi kerak.
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true, deletedAt: true },
    });

    if (!user || user.deletedAt) {
      throw ApiError.unauthorized('Hisob mavjud emas');
    }

    // Rol tokendan emas, BAZADAN olinadi. Admin huquqi tortib olinganda
    // eski token bilan yana admin bo'lib qolmasligi uchun.
    req.user = { id: user.id, role: user.role };
  });

  app.decorate('requireAdmin', async (req: FastifyRequest, reply: FastifyReply) => {
    await app.authenticate(req, reply);
    if (req.user?.role !== 'admin') {
      throw ApiError.forbidden('Bu bo\'lim faqat administratorlar uchun');
    }
  });
};

export const authPlugin = fp(plugin, { name: 'auth' });
