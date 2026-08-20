import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { prisma } from '../db/prisma.js';
import { ApiError } from '../lib/errors.js';
import { type CachedUser, getCachedUser, setCachedUser } from './user-cache.js';
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
    //
    // Bu tekshiruv KESHLANADI (30 soniya): busiz har bir so'rov bazaga
    // borardi va uzoqdagi bazada bu har bosishga ~1 soniya qo'shardi.
    // Xavfsizlikka ta'siri kichik — token baribir 15 daqiqa yashaydi.
    const cached = getCachedUser(payload.sub);

    let user: CachedUser | null;
    if (cached !== undefined) {
      user = cached;
    } else {
      const row = await prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, role: true, deletedAt: true },
      });
      user = !row || row.deletedAt ? null : { id: row.id, role: row.role };
      // Manfiy natija ham keshlanadi: o'chirilgan hisob bilan qayta-qayta
      // urinish bazani bekorga yuklamasin.
      setCachedUser(payload.sub, user);
    }

    if (!user) throw ApiError.unauthorized('Hisob mavjud emas');

    // Rol tokendan emas, BAZADAN olinadi (keshlangan bo'lsa ham). Admin
    // huquqi tortib olinganda eski token bilan admin bo'lib qolmaydi.
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
