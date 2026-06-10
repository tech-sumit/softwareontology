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

  fastify.get('/markings/:id/datasets', { preHandler: requirePermission('governance:read') }, async (req) => {
    const { id } = req.params as { id: string };
    return { datasets: await svc.markingDatasets(req.user!.orgId, id) };
  });

  fastify.get('/markings/:id/roles', { preHandler: requirePermission('governance:read') }, async (req) => {
    const { id } = req.params as { id: string };
    return { roles: await svc.markingRoles(req.user!.orgId, id) };
  });

  fastify.delete('/markings/:id/datasets/:datasetId', { preHandler: requirePermission('governance:manage') }, async (req, reply) => {
    const { id, datasetId } = req.params as { id: string; datasetId: string };
    try {
      const ok = await svc.removeMarkingFromDataset(req.user!.orgId, id, datasetId);
      return ok ? reply.send({ ok: true }) : reply.code(404).send({ error: 'marking not applied to dataset' });
    } catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  fastify.delete('/markings/:id/roles/:roleId', { preHandler: requirePermission('governance:manage') }, async (req, reply) => {
    const { id, roleId } = req.params as { id: string; roleId: string };
    try {
      const ok = await svc.revokeMarkingFromRole(req.user!.orgId, id, roleId);
      return ok ? reply.send({ ok: true }) : reply.code(404).send({ error: 'marking not granted to role' });
    } catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  fastify.get('/datasets/:datasetId/markings', { preHandler: requirePermission('governance:read') }, async (req) => {
    const { datasetId } = req.params as { datasetId: string };
    return { markings: await svc.datasetMarkings(datasetId) };
  });

  fastify.get('/me/clearances', { preHandler: requirePermission('governance:read') }, async (req) => ({ clearances: await svc.userClearances(req.user!.id) }));
};
