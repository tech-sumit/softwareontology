import type { FastifyPluginAsync } from 'fastify';
import { requirePermission } from '@so/auth';
import { createAipService } from './service.js';

export const aipRoutes: FastifyPluginAsync = async (fastify) => {
  const svc = createAipService(fastify.ctx);

  fastify.post('/complete', { preHandler: requirePermission('aip:use') }, async (req, reply) => {
    const body = req.body as { prompt?: string };
    if (!body?.prompt) return reply.code(400).send({ error: 'prompt required' });
    return { completion: await svc.complete(body.prompt) };
  });

  const statusFor = (e: unknown): number => ((e as { statusCode?: number }).statusCode === 403 ? 403 : 400);

  fastify.post('/ask', { preHandler: requirePermission('aip:use') }, async (req, reply) => {
    const body = req.body as { objectType?: string; question?: string };
    if (!body?.objectType || !body?.question) return reply.code(400).send({ error: 'objectType and question required' });
    const principal = { userId: req.user!.id, permissions: req.user!.permissions };
    try { return { answer: await svc.ask(req.user!.orgId, body.objectType, body.question, principal) }; }
    catch (e) { return reply.code(statusFor(e)).send({ error: (e as Error).message }); }
  });

  fastify.post('/index', { preHandler: requirePermission('aip:use') }, async (req, reply) => {
    const b = req.body as { objectType?: string };
    if (!b?.objectType) return reply.code(400).send({ error: 'objectType required' });
    const principal = { userId: req.user!.id, permissions: req.user!.permissions };
    try { return reply.send(await svc.indexObjectType(req.user!.orgId, b.objectType, principal)); }
    catch (e) { return reply.code(statusFor(e)).send({ error: (e as Error).message }); }
  });

  fastify.post('/search', { preHandler: requirePermission('aip:use') }, async (req, reply) => {
    const b = req.body as { objectType?: string; query?: string; k?: number };
    if (!b?.objectType || !b?.query) return reply.code(400).send({ error: 'objectType and query required' });
    const principal = { userId: req.user!.id, permissions: req.user!.permissions };
    try { return reply.send({ results: await svc.search(req.user!.orgId, b.objectType, b.query, b.k ?? 10, principal) }); }
    catch (e) { return reply.code(statusFor(e)).send({ error: (e as Error).message }); }
  });

  fastify.post('/agent', { preHandler: requirePermission('aip:use') }, async (req, reply) => {
    const b = req.body as { question?: string };
    if (!b?.question) return reply.code(400).send({ error: 'question required' });
    const principal = { userId: req.user!.id, permissions: req.user!.permissions };
    try { return reply.send(await svc.agent(req.user!.orgId, b.question, undefined, principal)); }
    catch (e) { return reply.code(statusFor(e)).send({ error: (e as Error).message }); }
  });
};
