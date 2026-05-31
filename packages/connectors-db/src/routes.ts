import type { FastifyPluginAsync } from 'fastify';
import { requirePermission } from '@so/auth';
import { activeProjectId } from '@so/sdk';
import { createConnectorService, type ConnectorInput } from './service.js';

export const connectorRoutes: FastifyPluginAsync = async (fastify) => {
  const svc = createConnectorService(fastify.ctx);

  fastify.post('/', { preHandler: requirePermission('connectors:write') }, async (req, reply) => {
    const body = req.body as Partial<ConnectorInput>;
    if (!body?.name || !body?.sourceConnString || !body?.sourceTable) return reply.code(400).send({ error: 'name, sourceConnString, sourceTable required' });
    try { const id = await svc.createConnector(req.user!.orgId, activeProjectId(req.headers), body as ConnectorInput); return reply.code(201).send({ id }); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  fastify.get('/', { preHandler: requirePermission('connectors:read') }, async (req) => ({ connectors: await svc.listConnectors(req.user!.orgId, activeProjectId(req.headers)) }));

  fastify.post('/:id/sync', { preHandler: requirePermission('connectors:write') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try { return reply.code(200).send(await svc.sync(req.user!.orgId, id)); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });
};
