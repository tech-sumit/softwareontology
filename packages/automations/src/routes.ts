import type { FastifyPluginAsync } from 'fastify';
import { requirePermission, requireProjectMembership } from '@so/auth';
import { activeProjectId } from '@so/sdk';
import { createAutomationService, type AutomationInput } from './service.js';

export const automationRoutes: FastifyPluginAsync = async (fastify) => {
  const svc = createAutomationService(fastify.ctx);
  fastify.post('/', { preHandler: [requirePermission('automations:write'), requireProjectMembership()] }, async (req, reply) => {
    const body = req.body as Partial<AutomationInput>;
    if (!body?.name || !body?.triggerAction || !body?.thenAction) return reply.code(400).send({ error: 'name, triggerAction, thenAction required' });
    try { const id = await svc.createAutomation(req.user!.orgId, activeProjectId(req.headers), { name: body.name, triggerAction: body.triggerAction, thenAction: body.thenAction, thenEdits: body.thenEdits ?? {} }); return reply.code(201).send({ id }); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });
  fastify.get('/', { preHandler: [requirePermission('automations:read'), requireProjectMembership()] }, async (req) => ({ automations: await svc.listAutomations(req.user!.orgId, activeProjectId(req.headers)) }));

  fastify.delete('/:id', { preHandler: [requirePermission('automations:write'), requireProjectMembership()] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const ok = await svc.deleteAutomation(req.user!.orgId, id);
    return ok ? reply.send({ ok: true }) : reply.code(404).send({ error: 'automation not found' });
  });
};
