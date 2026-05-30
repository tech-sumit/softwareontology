import type { FastifyPluginAsync } from 'fastify';
import { requirePermission } from '@so/auth';
import { createPipelineService, type PipelineInput } from './service.js';

export const pipelineRoutes: FastifyPluginAsync = async (fastify) => {
  const svc = createPipelineService(fastify.ctx);

  fastify.post('/', { preHandler: requirePermission('pipelines:write') }, async (req, reply) => {
    const body = req.body as Partial<PipelineInput>;
    if (!body?.name || !Array.isArray(body?.inputs) || (!body?.sql && !Array.isArray(body?.steps))) return reply.code(400).send({ error: 'name, inputs[], and sql or steps[] required' });
    try { const id = await svc.createPipeline(req.user!.orgId, body as PipelineInput); return reply.code(201).send({ id }); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  fastify.get('/', { preHandler: requirePermission('pipelines:read') }, async (req) => ({ pipelines: await svc.listPipelines(req.user!.orgId) }));

  fastify.post('/:id/run', { preHandler: requirePermission('pipelines:write') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try { return reply.code(200).send(await svc.run(req.user!.orgId, id)); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });
};
