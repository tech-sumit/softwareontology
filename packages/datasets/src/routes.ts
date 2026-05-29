import type { FastifyPluginAsync } from 'fastify';
import { requirePermission } from '@so/auth';
import { createDatasetService } from './service.js';

export const datasetRoutes: FastifyPluginAsync = async (fastify) => {
  // Accept raw file bodies for upload.
  fastify.addContentTypeParser(
    ['text/csv', 'application/octet-stream'],
    { parseAs: 'buffer' },
    (_req, body, done) => done(null, body),
  );

  const svc = createDatasetService(fastify.ctx);

  fastify.post('/', { preHandler: requirePermission('datasets:write') }, async (req, reply) => {
    const q = req.query as { name?: string; format?: string };
    if (!q.name) return reply.code(400).send({ error: 'name query param required' });
    const format = q.format === 'parquet' ? 'parquet' : 'csv';
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      return reply.code(400).send({ error: 'empty upload body' });
    }
    const orgId = req.user!.orgId;
    const dataset = await svc.ingest(orgId, q.name, format, body);
    return reply.code(201).send({ dataset });
  });

  fastify.get('/', { preHandler: requirePermission('datasets:read') }, async (req) => {
    return { datasets: await svc.list(req.user!.orgId) };
  });

  fastify.get('/:id', { preHandler: requirePermission('datasets:read') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const ds = await svc.get(req.user!.orgId, id);
    if (!ds) return reply.code(404).send({ error: 'not found' });
    return { dataset: ds };
  });

  fastify.get('/:id/preview', { preHandler: requirePermission('datasets:read') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as { limit?: string; offset?: string };
    const ds = await svc.get(req.user!.orgId, id);
    if (!ds) return reply.code(404).send({ error: 'not found' });
    const rows = await svc.preview(ds.objectKey, Number(q.limit ?? 50), Number(q.offset ?? 0));
    return { rows };
  });
};
