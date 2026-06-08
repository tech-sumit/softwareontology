import type { FastifyPluginAsync } from 'fastify';
import type { DatasetAccessPolicy } from '@so/sdk';
import { activeBranch } from '@so/sdk';
import { requirePermission, hasPermission } from '@so/auth';
import { createOntologyService, type ObjectTypeInput } from './service.js';

export const ontologyRoutes: FastifyPluginAsync = async (fastify) => {
  const svc = createOntologyService(fastify.ctx);

  fastify.post('/object-types', { preHandler: requirePermission('ontology:edit') }, async (req, reply) => {
    const body = req.body as ObjectTypeInput;
    if (!body?.apiName || !body?.datasetId || !body?.primaryKey || !Array.isArray(body?.properties)) {
      return reply.code(400).send({ error: 'apiName, datasetId, primaryKey, properties[] required' });
    }
    try {
      const ot = await svc.createObjectType(req.user!.orgId, body);
      return reply.code(201).send({ objectType: ot });
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  fastify.get('/object-types', { preHandler: requirePermission('ontology:read') }, async (req) => {
    return { objectTypes: await svc.listObjectTypes(req.user!.orgId) };
  });

  fastify.get('/object-types/:apiName', { preHandler: requirePermission('ontology:read') }, async (req, reply) => {
    const { apiName } = req.params as { apiName: string };
    const ot = await svc.getObjectType(req.user!.orgId, apiName);
    if (!ot) return reply.code(404).send({ error: 'not found' });
    const links = (await svc.listLinkTypes(req.user!.orgId)).filter((l) => l.fromObjectType === ot.apiName);
    return { objectType: { apiName: ot.apiName, datasetId: ot.datasetId, primaryKey: ot.primaryKey, properties: ot.properties, functions: ot.functions ?? [], links } };
  });

  fastify.get('/link-types', { preHandler: requirePermission('ontology:read') }, async (req) => ({ linkTypes: await svc.listLinkTypes(req.user!.orgId) }));

  fastify.get('/object-types/:apiName/objects', { preHandler: requirePermission('ontology:read') }, async (req, reply) => {
    const { apiName } = req.params as { apiName: string };
    const q = req.query as { limit?: string; offset?: string };
    try {
      const ot = await svc.getObjectType(req.user!.orgId, apiName);
      if (!ot) return reply.code(404).send({ error: 'not found' });
      const policies = fastify.ctx.registry.get<DatasetAccessPolicy>('datasetAccessPolicies');
      for (const policy of policies) {
        if (!(await policy.check(fastify.ctx, req.user!.id, ot.datasetId))) {
          return reply.code(403).send({ error: 'access denied: insufficient clearance' });
        }
      }
      const perms = req.user!.permissions;
      const masked = ot.properties.filter((p) => p.requiredPermission && !hasPermission(perms, p.requiredPermission)).map((p) => p.apiName);
      const objects = await svc.resolveObjects(req.user!.orgId, apiName, { limit: Number(q.limit ?? 100), offset: Number(q.offset ?? 0), branch: activeBranch(req.headers) });
      const result = masked.length === 0 ? objects : objects.map((o) => { for (const m of masked) delete o[m]; return o; });
      return { objects: result };
    } catch (e) {
      return reply.code(404).send({ error: (e as Error).message });
    }
  });

  fastify.post('/object-types/:apiName/functions', { preHandler: requirePermission('ontology:edit') }, async (req, reply) => {
    const { apiName } = req.params as { apiName: string };
    const body = req.body as { apiName?: string; expression?: string; type?: string };
    if (!body?.apiName || !body?.expression || !body?.type) {
      return reply.code(400).send({ error: 'apiName, expression, type required' });
    }
    try {
      await svc.createFunction(req.user!.orgId, apiName, { apiName: body.apiName, expression: body.expression, type: body.type as never });
      return reply.code(201).send({ ok: true });
    } catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  fastify.post('/object-types/:apiName/properties/:propName/security', { preHandler: requirePermission('ontology:edit') }, async (req, reply) => {
    const { apiName, propName } = req.params as { apiName: string; propName: string };
    const body = req.body as { requiredPermission?: string | null };
    try {
      await svc.setPropertySecurity(req.user!.orgId, apiName, propName, body?.requiredPermission ?? null);
      return reply.code(200).send({ ok: true });
    } catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  fastify.post('/link-types', { preHandler: requirePermission('ontology:edit') }, async (req, reply) => {
    const body = req.body as { apiName?: string; fromObjectType?: string; toObjectType?: string; foreignKeyProperty?: string };
    if (!body?.apiName || !body?.fromObjectType || !body?.toObjectType || !body?.foreignKeyProperty) {
      return reply.code(400).send({ error: 'apiName, fromObjectType, toObjectType, foreignKeyProperty required' });
    }
    try {
      await svc.createLinkType(req.user!.orgId, body as Required<typeof body>);
      return reply.code(201).send({ ok: true });
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  fastify.get('/object-types/:apiName/objects/:pk/links/:linkApiName', { preHandler: requirePermission('ontology:read') }, async (req, reply) => {
    const { apiName, pk, linkApiName } = req.params as { apiName: string; pk: string; linkApiName: string };
    try {
      return { objects: await svc.resolveLinkedObjects(req.user!.orgId, apiName, pk, linkApiName, activeBranch(req.headers)) };
    } catch (e) { return reply.code(404).send({ error: (e as Error).message }); }
  });

  fastify.get('/branches', { preHandler: requirePermission('ontology:read') }, async (req) => ({ branches: await svc.listBranches(req.user!.orgId) }));
  fastify.post('/branches', { preHandler: requirePermission('ontology:edit') }, async (req, reply) => {
    const b = req.body as { name?: string };
    if (!b?.name) return reply.code(400).send({ error: 'name required' });
    try { await svc.createBranch(req.user!.orgId, b.name, req.user!.id); return reply.code(201).send({ ok: true }); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });
  fastify.get('/branches/:name/diff', { preHandler: requirePermission('ontology:read') }, async (req, reply) => {
    const { name } = req.params as { name: string };
    try { return reply.send(await svc.diffBranch(req.user!.orgId, name)); } catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });
  fastify.post('/branches/:name/merge', { preHandler: requirePermission('ontology:edit') }, async (req, reply) => {
    const { name } = req.params as { name: string };
    try { return reply.send(await svc.mergeBranch(req.user!.orgId, name, req.user!.id)); } catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });
  fastify.delete('/branches/:name', { preHandler: requirePermission('ontology:edit') }, async (req, reply) => {
    const { name } = req.params as { name: string };
    try { await svc.deleteBranch(req.user!.orgId, name); return reply.send({ ok: true }); } catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });
};
