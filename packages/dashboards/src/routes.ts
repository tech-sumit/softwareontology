import type { FastifyPluginAsync } from 'fastify';
import { requirePermission } from '@so/auth';
import { createDashboardService } from './service.js';

export const dashboardRoutes: FastifyPluginAsync = async (fastify) => {
  const svc = createDashboardService(fastify.ctx);
  fastify.post('/aggregate', { preHandler: requirePermission('ontology:read') }, async (req, reply) => {
    const body = req.body as { objectType?: string; groupBy?: string };
    if (!body?.objectType || !body?.groupBy) return reply.code(400).send({ error: 'objectType and groupBy required' });
    try {
      const principal = { userId: req.user!.id, permissions: req.user!.permissions };
      return { buckets: await svc.aggregate(req.user!.orgId, body.objectType, body.groupBy, principal) };
    } catch (e) {
      if ((e as { statusCode?: number }).statusCode === 403) {
        return reply.code(403).send({ error: 'access denied' });
      }
      return reply.code(400).send({ error: (e as Error).message });
    }
  });
};
