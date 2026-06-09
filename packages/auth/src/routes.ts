import type { FastifyPluginAsync } from 'fastify';
import { randomBytes } from 'node:crypto';
import { createAuthService } from './service.js';
import { createOidcService } from './oidc.js';

export const SESSION_COOKIE = 'so_session';

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  const auth = createAuthService(fastify.ctx.db);

  fastify.post('/login', async (req, reply) => {
    const body = (req.body ?? {}) as { email?: string; password?: string };
    if (!body.email || !body.password) {
      return reply.code(400).send({ error: 'email and password required' });
    }
    const token = await auth.login(body.email, body.password);
    if (!token) return reply.code(401).send({ error: 'invalid credentials' });
    reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/', secure: fastify.ctx.config.get('COOKIE_SECURE') === 'true' });
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

  fastify.get('/oidc/login', async (_req, reply) => {
    const oidc = createOidcService(fastify.ctx.db, fastify.ctx.config);
    return reply.redirect(oidc.authUrl(randomBytes(8).toString('hex')));
  });

  fastify.get('/oidc/callback', async (req, reply) => {
    const q = req.query as { code?: string };
    if (!q.code) return reply.code(400).send({ error: 'code required' });
    try {
      const oidc = createOidcService(fastify.ctx.db, fastify.ctx.config);
      const token = await oidc.handleCallback(q.code);
      reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/', secure: fastify.ctx.config.get('COOKIE_SECURE') === 'true' });
      return reply.redirect('/');
    } catch (e) { return reply.code(401).send({ error: (e as Error).message }); }
  });
};
