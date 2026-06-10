import type { FastifyPluginAsync } from 'fastify';
import { requirePermission } from '@so/auth';
import { createAdminService } from './service.js';

export const adminRoutes: FastifyPluginAsync = async (fastify) => {
  const svc = createAdminService(fastify.ctx);

  fastify.get('/users', { preHandler: requirePermission('admin:users') }, async (req) => ({ users: await svc.listUsers(req.user!.orgId) }));

  fastify.post('/users', { preHandler: requirePermission('admin:users') }, async (req, reply) => {
    const body = req.body as { email?: string; password?: string; roleNames?: string[] };
    if (!body?.email || !body?.password) return reply.code(400).send({ error: 'email and password required' });
    try {
      const user = await svc.createUser(req.user!.orgId, { email: body.email, password: body.password, ...(body.roleNames ? { roleNames: body.roleNames } : {}) });
      return reply.code(201).send({ user });
    } catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  fastify.get('/roles', { preHandler: requirePermission('admin:roles') }, async (req) => ({ roles: await svc.listRoles(req.user!.orgId) }));

  fastify.post('/roles', { preHandler: requirePermission('admin:roles') }, async (req, reply) => {
    const body = req.body as { name?: string; permissions?: string[] };
    if (!body?.name || !Array.isArray(body?.permissions)) return reply.code(400).send({ error: 'name and permissions[] required' });
    try { await svc.createRole(req.user!.orgId, { name: body.name, permissions: body.permissions }); return reply.code(201).send({ ok: true }); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  fastify.delete('/users/:id', { preHandler: requirePermission('admin:users') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (req.user!.id === id) return reply.code(400).send({ error: 'cannot delete yourself' });
    const ok = await svc.deleteUser(req.user!.orgId, id);
    return ok ? reply.send({ ok: true }) : reply.code(404).send({ error: 'user not found' });
  });

  fastify.delete('/roles/:id', { preHandler: requirePermission('admin:roles') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const ok = await svc.deleteRole(req.user!.orgId, id);
      return ok ? reply.send({ ok: true }) : reply.code(404).send({ error: 'role not found' });
    } catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  fastify.get('/permissions', { preHandler: requirePermission('admin:roles') }, async () => ({ permissions: svc.listPermissions() }));
};
