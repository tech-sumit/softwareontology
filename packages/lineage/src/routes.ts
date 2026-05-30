import type { FastifyPluginAsync } from 'fastify';
import { requirePermission } from '@so/auth';
import { createLineageService } from './service.js';

export const lineageRoutes: FastifyPluginAsync = async (fastify) => {
  const svc = createLineageService(fastify.ctx);
  fastify.get('/object-types/:apiName', { preHandler: requirePermission('ontology:read') }, async (req, reply) => {
    const { apiName } = req.params as { apiName: string };
    const lin = await svc.forObjectType(req.user!.orgId, apiName);
    if (!lin) return reply.code(404).send({ error: 'not found' });
    return { lineage: lin };
  });
};
