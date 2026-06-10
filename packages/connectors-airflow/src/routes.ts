import type { FastifyPluginAsync } from 'fastify';
import { requirePermission, requireProjectMembership } from '@so/auth';
import { activeProjectId } from '@so/sdk';
import { createAirflowConnectorService, type AirflowConnectorInput } from './service.js';

export const airflowConnectorRoutes: FastifyPluginAsync = async (fastify) => {
  const svc = createAirflowConnectorService(fastify.ctx);
  fastify.post('/', { preHandler: [requirePermission('connectors:write'), requireProjectMembership()] }, async (req, reply) => {
    const b = req.body as Partial<AirflowConnectorInput>;
    if (!b?.name || !b?.provider || !b?.conn || !b?.query) return reply.code(400).send({ error: 'name, provider, conn, query required' });
    try { return reply.code(201).send({ id: await svc.createConnector(req.user!.orgId, activeProjectId(req.headers), b as AirflowConnectorInput) }); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });
  fastify.get('/', { preHandler: [requirePermission('connectors:read'), requireProjectMembership()] }, async (req) => ({ connectors: await svc.listConnectors(req.user!.orgId, activeProjectId(req.headers)) }));
  fastify.post('/:id/sync', { preHandler: requirePermission('connectors:write') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try { return reply.code(200).send(await svc.sync(req.user!.orgId, id)); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });
  fastify.delete('/:id', { preHandler: [requirePermission('connectors:write'), requireProjectMembership()] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const ok = await svc.deleteConnector(req.user!.orgId, id);
    return ok ? reply.send({ ok: true }) : reply.code(404).send({ error: 'connector not found' });
  });
};
