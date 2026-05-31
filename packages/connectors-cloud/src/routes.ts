import type { FastifyPluginAsync } from 'fastify';
import { requirePermission } from '@so/auth';
import { activeProjectId } from '@so/sdk';
import { createCloudConnectorService } from './service.js';

export const cloudConnectorRoutes: FastifyPluginAsync = async (fastify) => {
  const svc = createCloudConnectorService(fastify.ctx);
  fastify.post('/s3', { preHandler: requirePermission('connectors:write') }, async (req, reply) => {
    const b = req.body as { name?: string; s3Url?: string; format?: string };
    if (!b?.name || !b?.s3Url) return reply.code(400).send({ error: 'name, s3Url required' });
    try { return reply.code(201).send({ id: await svc.createConnector(req.user!.orgId, activeProjectId(req.headers), { name: b.name, kind: 's3', config: { s3Url: b.s3Url, format: b.format ?? 'csv' } }) }); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });
  fastify.post('/rest', { preHandler: requirePermission('connectors:write') }, async (req, reply) => {
    const b = req.body as { name?: string; url?: string; arrayPath?: string };
    if (!b?.name || !b?.url) return reply.code(400).send({ error: 'name, url required' });
    try { return reply.code(201).send({ id: await svc.createConnector(req.user!.orgId, activeProjectId(req.headers), { name: b.name, kind: 'rest', config: { url: b.url, arrayPath: b.arrayPath } }) }); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });
  fastify.get('/', { preHandler: requirePermission('connectors:read') }, async (req) => ({ connectors: await svc.listConnectors(req.user!.orgId, activeProjectId(req.headers)) }));
  fastify.post('/:id/sync', { preHandler: requirePermission('connectors:write') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try { return reply.code(200).send(await svc.sync(req.user!.orgId, id)); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });
};
