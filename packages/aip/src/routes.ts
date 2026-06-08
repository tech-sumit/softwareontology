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

  fastify.post('/ask', { preHandler: requirePermission('aip:use') }, async (req, reply) => {
    const body = req.body as { objectType?: string; question?: string };
    if (!body?.objectType || !body?.question) return reply.code(400).send({ error: 'objectType and question required' });
    try { return { answer: await svc.ask(req.user!.orgId, body.objectType, body.question) }; }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  fastify.post('/index', { preHandler: requirePermission('aip:use') }, async (req, reply) => {
    const b = req.body as { objectType?: string };
    if (!b?.objectType) return reply.code(400).send({ error: 'objectType required' });
    try { return reply.send(await svc.indexObjectType(req.user!.orgId, b.objectType)); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  fastify.post('/search', { preHandler: requirePermission('aip:use') }, async (req, reply) => {
    const b = req.body as { objectType?: string; query?: string; k?: number };
    if (!b?.objectType || !b?.query) return reply.code(400).send({ error: 'objectType and query required' });
    try { return reply.send({ results: await svc.search(req.user!.orgId, b.objectType, b.query, b.k ?? 10) }); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  fastify.post('/agent', { preHandler: requirePermission('aip:use') }, async (req, reply) => {
    const b = req.body as { question?: string };
    if (!b?.question) return reply.code(400).send({ error: 'question required' });
    try { return reply.send(await svc.agent(req.user!.orgId, b.question)); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });
};
