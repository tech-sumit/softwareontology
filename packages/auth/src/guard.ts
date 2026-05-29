import type { preHandlerHookHandler } from 'fastify';
import { createAuthService, hasPermission, type AuthUser } from './service.js';
import { SESSION_COOKIE } from './routes.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

/** Fastify preHandler: require a valid session AND the given permission. */
export function requirePermission(permission: string): preHandlerHookHandler {
  return async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) return reply.code(401).send({ error: 'unauthenticated' });
    const auth = createAuthService(req.server.ctx.db);
    const user = await auth.validateSession(token);
    if (!user) return reply.code(401).send({ error: 'unauthenticated' });
    if (!hasPermission(user.permissions, permission)) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    req.user = user;
  };
}
