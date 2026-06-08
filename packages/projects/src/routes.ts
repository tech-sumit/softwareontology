import type { FastifyPluginAsync } from 'fastify';
import { requirePermission } from '@so/auth';
import { createProjectService, roleAtLeast, type ProjectRole } from './service.js';

export const projectRoutes: FastifyPluginAsync = async (fastify) => {
  const svc = createProjectService(fastify.ctx);
  async function roleFor(perms: string[], userId: string, projectId: string): Promise<string | null> {
    return perms.includes('*') ? 'admin' : await svc.memberRole(projectId, userId);
  }

  fastify.post('/', { preHandler: requirePermission('projects:write') }, async (req, reply) => {
    const b = req.body as { name?: string; description?: string };
    if (!b?.name) return reply.code(400).send({ error: 'name required' });
    try { return reply.code(201).send({ id: await svc.createProject(req.user!.orgId, b.name, b.description, req.user!.id) }); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  fastify.get('/', { preHandler: requirePermission('projects:read') }, async (req) => ({ projects: await svc.listProjects(req.user!.orgId, req.user!.id, req.user!.permissions.includes('*')) }));
  fastify.get('/archived', { preHandler: requirePermission('projects:read') }, async (req) => ({ projects: await svc.listArchivedProjects(req.user!.orgId, req.user!.id, req.user!.permissions.includes('*')) }));

  fastify.get('/:id', { preHandler: requirePermission('projects:read') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = await svc.getProject(req.user!.orgId, id, req.user!.id, req.user!.permissions.includes('*'));
    return p ? reply.send(p) : reply.code(404).send({ error: 'project not found' });
  });

  fastify.patch('/:id', { preHandler: requirePermission('projects:write') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!roleAtLeast(await roleFor(req.user!.permissions, req.user!.id, id), 'owner')) return reply.code(403).send({ error: 'forbidden' });
    const b = (req.body ?? {}) as { name?: string; description?: string };
    try { const p = await svc.updateProject(req.user!.orgId, id, b); return p ? reply.send(p) : reply.code(404).send({ error: 'project not found' }); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  fastify.post('/:id/archive', { preHandler: requirePermission('projects:write') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!roleAtLeast(await roleFor(req.user!.permissions, req.user!.id, id), 'owner')) return reply.code(403).send({ error: 'forbidden' });
    try { const ok = await svc.setArchived(req.user!.orgId, id, true); return ok ? reply.send({ ok: true }) : reply.code(404).send({ error: 'project not found' }); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  fastify.post('/:id/restore', { preHandler: requirePermission('projects:write') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!roleAtLeast(await roleFor(req.user!.permissions, req.user!.id, id), 'owner')) return reply.code(403).send({ error: 'forbidden' });
    try { const ok = await svc.setArchived(req.user!.orgId, id, false); return ok ? reply.send({ ok: true }) : reply.code(404).send({ error: 'project not found' }); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  fastify.get('/:id/members', { preHandler: requirePermission('projects:read') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await roleFor(req.user!.permissions, req.user!.id, id))) return reply.code(403).send({ error: 'forbidden' });
    return reply.send({ members: await svc.listMembers(id) });
  });

  fastify.get('/:id/candidates', { preHandler: requirePermission('projects:write') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!roleAtLeast(await roleFor(req.user!.permissions, req.user!.id, id), 'owner')) return reply.code(403).send({ error: 'forbidden' });
    return reply.send({ users: await svc.listCandidates(req.user!.orgId, id) });
  });

  fastify.post('/:id/members', { preHandler: requirePermission('projects:write') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!roleAtLeast(await roleFor(req.user!.permissions, req.user!.id, id), 'owner')) return reply.code(403).send({ error: 'forbidden' });
    const b = req.body as { userId?: string; role?: string };
    if (!b?.userId || !b?.role) return reply.code(400).send({ error: 'userId and role required' });
    try { await svc.addMember(id, b.userId, b.role as ProjectRole); return reply.code(201).send({ ok: true }); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  fastify.patch('/:id/members/:userId', { preHandler: requirePermission('projects:write') }, async (req, reply) => {
    const { id, userId } = req.params as { id: string; userId: string };
    if (!roleAtLeast(await roleFor(req.user!.permissions, req.user!.id, id), 'owner')) return reply.code(403).send({ error: 'forbidden' });
    const b = req.body as { role?: string };
    if (!b?.role) return reply.code(400).send({ error: 'role required' });
    try { const ok = await svc.setMemberRole(id, userId, b.role as ProjectRole); return ok ? reply.send({ ok: true }) : reply.code(404).send({ error: 'member not found' }); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  fastify.delete('/:id/members/:userId', { preHandler: requirePermission('projects:write') }, async (req, reply) => {
    const { id, userId } = req.params as { id: string; userId: string };
    if (!roleAtLeast(await roleFor(req.user!.permissions, req.user!.id, id), 'owner')) return reply.code(403).send({ error: 'forbidden' });
    try { const ok = await svc.removeMember(id, userId); return ok ? reply.send({ ok: true }) : reply.code(404).send({ error: 'member not found' }); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });
};
