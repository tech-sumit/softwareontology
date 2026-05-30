import type { FastifyPluginAsync } from 'fastify';
import { requirePermission } from '@so/auth';
import { createCatalogService } from './service.js';

export const catalogRoutes: FastifyPluginAsync = async (fastify) => {
  const svc = createCatalogService(fastify.ctx);

  fastify.get('/audit', { preHandler: requirePermission('catalog:read') }, async (req) => {
    const q = req.query as { action?: string; objectType?: string };
    return { entries: await svc.audit(req.user!.orgId, q) };
  });

  fastify.get('/search', { preHandler: requirePermission('catalog:read') }, async (req, reply) => {
    const q = req.query as { q?: string };
    if (!q.q) return reply.code(400).send({ error: 'q required' });
    return { hits: await svc.search(req.user!.orgId, q.q) };
  });
};
