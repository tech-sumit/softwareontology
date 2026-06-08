import type { FastifyPluginAsync } from 'fastify';
import { requirePermission } from '@so/auth';
import { createProjectService } from './service.js';

export const projectRoutes: FastifyPluginAsync = async (fastify) => {
  const svc = createProjectService(fastify.ctx);

  fastify.post('/', { preHandler: requirePermission('projects:write') }, async (req, reply) => {
    const b = req.body as { name?: string; description?: string };
    if (!b?.name) return reply.code(400).send({ error: 'name required' });
    try { return reply.code(201).send({ id: await svc.createProject(req.user!.orgId, b.name, b.description) }); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  fastify.get('/', { preHandler: requirePermission('projects:read') }, async (req) => ({ projects: await svc.listProjects(req.user!.orgId) }));

  fastify.get('/:id', { preHandler: requirePermission('projects:read') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = await svc.getProject(req.user!.orgId, id);
    return p ? reply.send(p) : reply.code(404).send({ error: 'project not found' });
  });

  fastify.get('/archived', { preHandler: requirePermission('projects:read') }, async (req) => ({ projects: await svc.listArchivedProjects(req.user!.orgId) }));

  fastify.patch('/:id', { preHandler: requirePermission('projects:write') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as { name?: string; description?: string };
    try { const p = await svc.updateProject(req.user!.orgId, id, b); return p ? reply.send(p) : reply.code(404).send({ error: 'project not found' }); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  fastify.post('/:id/archive', { preHandler: requirePermission('projects:write') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try { const ok = await svc.setArchived(req.user!.orgId, id, true); return ok ? reply.send({ ok: true }) : reply.code(404).send({ error: 'project not found' }); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  fastify.post('/:id/restore', { preHandler: requirePermission('projects:write') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try { const ok = await svc.setArchived(req.user!.orgId, id, false); return ok ? reply.send({ ok: true }) : reply.code(404).send({ error: 'project not found' }); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });
};
