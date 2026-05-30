import { describe, it, expect, afterAll } from 'vitest';
import { createServer, createConfig, type AppServer } from '@so/server';
import { createLogger } from '@so/observability';
import openapiModule from '../src/index.js';

const config = createConfig({ DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so', S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'localhost:9000', S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin', S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin', S3_BUCKET: process.env.S3_BUCKET ?? 'so-datasets' });
let server: AppServer;
afterAll(async () => { await server?.stop(); });

describe('openapi: spec is served', () => {
  it('serves a valid OpenAPI 3.1 document', async () => {
    server = await createServer({ modules: [openapiModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();
    const res = await server.app.inject({ method: 'GET', url: '/api/openapi/spec' });
    expect(res.statusCode).toBe(200);
    const spec = res.json();
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.paths['/auth/login'].post.operationId).toBe('login');
    expect(spec.components.schemas.User).toBeDefined();
  });
});
