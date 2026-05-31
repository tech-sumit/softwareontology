import type { FastifyPluginAsync } from 'fastify';
import { requirePermission } from '@so/auth';
import { createGovernanceService } from './service.js';

export const governanceRoutes: FastifyPluginAsync = async (fastify) => {
  const svc = createGovernanceService(fastify.ctx);

  fastify.post('/markings', { preHandler: requirePermission('governance:manage') }, async (req, reply) => {
    const b = req.body as { name?: string };
    if (!b?.name) return reply.code(400).send({ error: 'name required' });
    try { return reply.code(201).send({ id: await svc.createMarking(req.user!.orgId, b.name) }); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  fastify.get('/markings', { preHandler: requirePermission('governance:read') }, async (req) => ({ markings: await svc.listMarkings(req.user!.orgId) }));

  fastify.post('/markings/:id/datasets/:datasetId', { preHandler: requirePermission('governance:manage') }, async (req, reply) => {
    const { id, datasetId } = req.params as { id: string; datasetId: string };
    try { await svc.applyToDataset(req.user!.orgId, datasetId, id); return reply.send({ ok: true }); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  fastify.post('/markings/:id/roles/:roleId', { preHandler: requirePermission('governance:manage') }, async (req, reply) => {
    const { id, roleId } = req.params as { id: string; roleId: string };
    try { await svc.grantToRole(req.user!.orgId, roleId, id); return reply.send({ ok: true }); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  fastify.get('/datasets/:datasetId/markings', { preHandler: requirePermission('governance:read') }, async (req) => {
    const { datasetId } = req.params as { datasetId: string };
    return { markings: await svc.datasetMarkings(datasetId) };
  });

  fastify.get('/me/clearances', { preHandler: requirePermission('governance:read') }, async (req) => ({ clearances: await svc.userClearances(req.user!.id) }));
};
