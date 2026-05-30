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
};
