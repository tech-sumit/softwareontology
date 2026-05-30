import type { FastifyPluginAsync } from 'fastify';
import { requirePermission } from '@so/auth';
import { createAppService } from './service.js';

export const appRoutes: FastifyPluginAsync = async (fastify) => {
  const svc = createAppService(fastify.ctx);
  fastify.post('/', { preHandler: requirePermission('apps:write') }, async (req, reply) => {
    const b = req.body as { name?: string; definition?: unknown };
    if (!b?.name) return reply.code(400).send({ error: 'name required' });
    try { return reply.code(201).send({ id: await svc.createApp(req.user!.orgId, b.name, b.definition ?? { widgets: [] }) }); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });
  fastify.get('/', { preHandler: requirePermission('apps:read') }, async (req) => ({ apps: await svc.listApps(req.user!.orgId) }));
  fastify.get('/:id', { preHandler: requirePermission('apps:read') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const app = await svc.getApp(req.user!.orgId, id);
    return app ? reply.send(app) : reply.code(404).send({ error: 'app not found' });
  });
  fastify.put('/:id', { preHandler: requirePermission('apps:write') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = req.body as { name?: string; definition?: unknown };
    try { const ok = await svc.updateApp(req.user!.orgId, id, b); return ok ? reply.send({ ok: true }) : reply.code(404).send({ error: 'app not found' }); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });
  fastify.delete('/:id', { preHandler: requirePermission('apps:write') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const ok = await svc.deleteApp(req.user!.orgId, id);
    return ok ? reply.send({ ok: true }) : reply.code(404).send({ error: 'app not found' });
  });
};
