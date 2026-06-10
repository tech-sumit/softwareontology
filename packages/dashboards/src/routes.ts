import type { FastifyPluginAsync } from 'fastify';
import { requirePermission } from '@so/auth';
import { createDashboardService, type MetricFn } from './service.js';

const METRIC_FNS: MetricFn[] = ['count', 'sum', 'avg'];

export const dashboardRoutes: FastifyPluginAsync = async (fastify) => {
  const svc = createDashboardService(fastify.ctx);

  fastify.post('/aggregate', { preHandler: requirePermission('ontology:read') }, async (req, reply) => {
    const body = req.body as { objectType?: string; groupBy?: string; fn?: string; property?: string };
    if (!body?.objectType || !body?.groupBy) return reply.code(400).send({ error: 'objectType and groupBy required' });
    const fn = (body.fn ?? 'count') as MetricFn;
    if (!METRIC_FNS.includes(fn)) return reply.code(400).send({ error: `fn must be one of ${METRIC_FNS.join(', ')}` });
    if (fn !== 'count' && !body.property) return reply.code(400).send({ error: `property required for ${fn}` });
    try {
      const principal = { userId: req.user!.id, permissions: req.user!.permissions };
      const metric = body.property ? { fn, property: body.property } : { fn };
      return { buckets: await svc.aggregate(req.user!.orgId, body.objectType, body.groupBy, principal, metric) };
    } catch (e) {
      if ((e as { statusCode?: number }).statusCode === 403) {
        return reply.code(403).send({ error: 'access denied' });
      }
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  fastify.post('/', { preHandler: requirePermission('dashboards:write') }, async (req, reply) => {
    const body = req.body as { name?: string; objectType?: string; groupBy?: string; fn?: string; property?: string | null };
    if (!body?.name || !body?.objectType || !body?.groupBy) {
      return reply.code(400).send({ error: 'name, objectType and groupBy required' });
    }
    const fn = (body.fn ?? 'count') as MetricFn;
    if (!METRIC_FNS.includes(fn)) return reply.code(400).send({ error: `fn must be one of ${METRIC_FNS.join(', ')}` });
    if (fn !== 'count' && !body.property) return reply.code(400).send({ error: `property required for ${fn}` });
    const id = await svc.saveDashboard(req.user!.orgId, { name: body.name, objectType: body.objectType, groupBy: body.groupBy, fn, property: body.property ?? null }, req.user!.id);
    return reply.code(201).send({ id });
  });

  fastify.get('/', { preHandler: requirePermission('dashboards:read') }, async (req) => {
    return { dashboards: await svc.listDashboards(req.user!.orgId) };
  });

  fastify.delete('/:id', { preHandler: requirePermission('dashboards:write') }, async (req) => {
    const { id } = req.params as { id: string };
    await svc.deleteDashboard(req.user!.orgId, id);
    return { ok: true };
  });
};
