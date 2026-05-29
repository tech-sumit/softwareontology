import cookie from '@fastify/cookie';
import type { FastifyPluginAsync } from 'fastify';
import { createAuthService } from './service.js';

export const SESSION_COOKIE = 'so_session';

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(cookie);
  const auth = createAuthService(fastify.ctx.db);

  fastify.post('/login', async (req, reply) => {
    const body = (req.body ?? {}) as { email?: string; password?: string };
    if (!body.email || !body.password) {
      return reply.code(400).send({ error: 'email and password required' });
    }
    const token = await auth.login(body.email, body.password);
    if (!token) return reply.code(401).send({ error: 'invalid credentials' });
    reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/' });
    return { ok: true };
  });

  fastify.get('/me', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) return reply.code(401).send({ error: 'unauthenticated' });
    const user = await auth.validateSession(token);
    if (!user) return reply.code(401).send({ error: 'unauthenticated' });
    return { user };
  });

  fastify.post('/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await auth.logout(token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });
};
