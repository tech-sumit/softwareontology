import Fastify, { type FastifyInstance, type FastifyPluginAsync, type FastifyError } from 'fastify';
import type { ModuleDefinition, ModuleContext, Config, Logger } from '@so/sdk';
import { createKernel, type Kernel } from '@so/kernel';
import { createConfig } from './config.js';
import { createDb, type DbService } from './services/db.js';
import { createObjectStore } from './services/object-store.js';
import { createQueryEngine } from './services/query-engine.js';

declare module 'fastify' {
  interface FastifyInstance {
    ctx: ModuleContext;
  }
}

export interface AppServer {
  app: FastifyInstance;
  kernel: Kernel;
  start(port?: number): Promise<string>;
  stop(): Promise<void>;
}

export async function createServer(opts: {
  modules: ModuleDefinition[];
  logger: Logger;
  config?: Config;
}): Promise<AppServer> {
  const config = opts.config ?? createConfig();
  const db: DbService = createDb(config);
  const objectStore = createObjectStore(config);
  const query = createQueryEngine(config);

  const kernel = createKernel({
    modules: opts.modules,
    services: { db, objectStore, query, config, log: opts.logger },
  });

  const app = Fastify({ logger: false });
  app.decorate('ctx', kernel.ctx);

  app.get('/healthz', async () => ({ status: 'ok' }));
  app.get('/readyz', async (_req, reply) => {
    try {
      await db.query('SELECT 1');
      return { status: 'ready' };
    } catch {
      return reply.code(503).send({ status: 'unavailable' });
    }
  });

  for (const m of opts.modules) {
    const routes = m.contributes?.apiRoutes as FastifyPluginAsync | undefined;
    if (routes) await app.register(routes, { prefix: `/api/${m.id}` });
  }

  app.setErrorHandler((err: FastifyError, _req, reply) => {
    opts.logger.error('request error', { err: err.message, statusCode: err.statusCode });
    void reply.code(err.statusCode ?? 500).send({ error: err.message });
  });

  return {
    app,
    kernel,
    async start(port = Number(config.get('PORT') ?? 3000)) {
      await kernel.start();
      return app.listen({ port, host: '0.0.0.0' });
    },
    async stop() {
      await app.close();
      await kernel.stop();
      await db.close();
    },
  };
}
