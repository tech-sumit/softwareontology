import { defineModule } from '@so/sdk';
import type { FastifyPluginAsync } from 'fastify';
import { openapiSpec } from './spec.js';

const routes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/spec', async () => openapiSpec);
};

export default defineModule({ id: 'openapi', contributes: { apiRoutes: routes } });
export { openapiSpec } from './spec.js';
