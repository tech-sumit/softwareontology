import type { FastifyPluginAsync } from 'fastify';
import { requirePermission } from '@so/auth';
import { createAirflowConnectorService, type AirflowConnectorInput } from './service.js';

export const airflowConnectorRoutes: FastifyPluginAsync = async (fastify) => {
  const svc = createAirflowConnectorService(fastify.ctx);
  fastify.post('/', { preHandler: requirePermission('connectors:write') }, async (req, reply) => {
    const b = req.body as Partial<AirflowConnectorInput>;
    if (!b?.name || !b?.provider || !b?.conn || !b?.query) return reply.code(400).send({ error: 'name, provider, conn, query required' });
    try { return reply.code(201).send({ id: await svc.createConnector(req.user!.orgId, b as AirflowConnectorInput) }); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });
  fastify.get('/', { preHandler: requirePermission('connectors:read') }, async (req) => ({ connectors: await svc.listConnectors(req.user!.orgId) }));
  fastify.post('/:id/sync', { preHandler: requirePermission('connectors:write') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try { return reply.code(200).send(await svc.sync(req.user!.orgId, id)); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });
};
