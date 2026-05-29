import { describe, it, expect, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { defineModule } from '@so/sdk';
import { createLogger } from '@so/observability';
import { createServer, type AppServer } from '../src/server.js';
import { createConfig } from '../src/config.js';

const config = createConfig({
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so',
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'localhost:9000',
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin',
  S3_BUCKET: process.env.S3_BUCKET ?? 'so-datasets',
});

const pingModule = defineModule({
  id: 'ping',
  contributes: {
    apiRoutes: async (fastify: FastifyInstance) => {
      fastify.get('/ping', async () => ({ pong: typeof fastify.ctx.config.get === 'function' }));
    },
  },
});

let server: AppServer;
afterAll(async () => { await server?.stop(); });

describe('createServer', () => {
  it('serves health, readiness, and mounted module routes', async () => {
    server = await createServer({ modules: [pingModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();

    const health = await server.app.inject({ method: 'GET', url: '/healthz' });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: 'ok' });

    const ready = await server.app.inject({ method: 'GET', url: '/readyz' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({ status: 'ready' });

    const ping = await server.app.inject({ method: 'GET', url: '/api/ping/ping' });
    expect(ping.statusCode).toBe(200);
    expect(ping.json()).toEqual({ pong: true });
  });
});
