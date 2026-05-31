import type { FastifyPluginAsync } from 'fastify';
import { requirePermission } from '@so/auth';
import { activeProjectId } from '@so/sdk';
import { createPipelineService, type PipelineInput } from './service.js';

export const pipelineRoutes: FastifyPluginAsync = async (fastify) => {
  const svc = createPipelineService(fastify.ctx);

  fastify.post('/', { preHandler: requirePermission('pipelines:write') }, async (req, reply) => {
    const body = req.body as Partial<PipelineInput>;
    if (!body?.name || !Array.isArray(body?.inputs) || (!body?.sql && !Array.isArray(body?.steps))) return reply.code(400).send({ error: 'name, inputs[], and sql or steps[] required' });
    try { const id = await svc.createPipeline(req.user!.orgId, activeProjectId(req.headers), body as PipelineInput); return reply.code(201).send({ id }); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  fastify.get('/', { preHandler: requirePermission('pipelines:read') }, async (req) => ({ pipelines: await svc.listPipelines(req.user!.orgId, activeProjectId(req.headers)) }));

  fastify.post('/:id/run', { preHandler: requirePermission('pipelines:write') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try { return reply.code(200).send(await svc.run(req.user!.orgId, id)); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  fastify.get('/:id/runs', { preHandler: requirePermission('pipelines:read') }, async (req) => {
    const { id } = req.params as { id: string };
    return { runs: await svc.listRuns(req.user!.orgId, id) };
  });

  fastify.get('/runs/:runId', { preHandler: requirePermission('pipelines:read') }, async (req, reply) => {
    const { runId } = req.params as { runId: string };
    const r = await svc.getRun(req.user!.orgId, runId);
    return r ? reply.send(r) : reply.code(404).send({ error: 'run not found' });
  });

  fastify.put('/:id/schedule', { preHandler: requirePermission('pipelines:write') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { cron?: string };
    if (!body?.cron) return reply.code(400).send({ error: 'cron required' });
    try { const ok = await svc.setSchedule(req.user!.orgId, id, body.cron); return ok ? reply.send({ ok: true }) : reply.code(404).send({ error: 'pipeline not found' }); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  fastify.delete('/:id/schedule', { preHandler: requirePermission('pipelines:write') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const ok = await svc.clearSchedule(req.user!.orgId, id);
    return ok ? reply.send({ ok: true }) : reply.code(404).send({ error: 'pipeline not found' });
  });
};
