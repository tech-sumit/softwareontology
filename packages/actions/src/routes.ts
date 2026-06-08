import type { FastifyPluginAsync } from 'fastify';
import { activeBranch } from '@so/sdk';
import { requirePermission } from '@so/auth';
import { createActionService, type ActionDefInput, type ExecuteInput } from './service.js';

export const actionRoutes: FastifyPluginAsync = async (fastify) => {
  const svc = createActionService(fastify.ctx);

  fastify.post('/definitions', { preHandler: requirePermission('actions:edit') }, async (req, reply) => {
    const body = req.body as ActionDefInput;
    if (!body?.apiName || !body?.objectType || !body?.kind) {
      return reply.code(400).send({ error: 'apiName, objectType, kind required' });
    }
    try {
      await svc.createActionDef(req.user!.orgId, body);
      return reply.code(201).send({ ok: true });
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  fastify.get('/definitions', { preHandler: requirePermission('actions:read') }, async (req) => {
    return { actions: await svc.listActionDefs(req.user!.orgId) };
  });

  fastify.post('/:apiName/execute', { preHandler: requirePermission('actions:execute') }, async (req, reply) => {
    const { apiName } = req.params as { apiName: string };
    const body = (req.body ?? {}) as ExecuteInput;
    try {
      await svc.execute(req.user!.orgId, req.user!.id, apiName, body, activeBranch(req.headers));
      return reply.code(200).send({ ok: true });
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });
};
