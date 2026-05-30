import type { FastifyPluginAsync } from 'fastify';
import { requirePermission } from '@so/auth';
import { createOntologyService, type ObjectTypeInput, type FunctionInput } from './service.js';

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
    return { objectType: { apiName: ot.apiName, datasetId: ot.datasetId, primaryKey: ot.primaryKey, properties: ot.properties } };
  });

  fastify.get('/object-types/:apiName/objects', { preHandler: requirePermission('ontology:read') }, async (req, reply) => {
    const { apiName } = req.params as { apiName: string };
    const q = req.query as { limit?: string; offset?: string };
    try {
      const objects = await svc.resolveObjects(req.user!.orgId, apiName, {
        limit: Number(q.limit ?? 100),
        offset: Number(q.offset ?? 0),
      });
      return { objects };
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
};
