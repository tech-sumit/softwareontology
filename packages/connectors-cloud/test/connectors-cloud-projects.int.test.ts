import { describe, it, expect, afterAll } from 'vitest';
import { createServer, createConfig, type AppServer } from '@so/server';
import { createLogger } from '@so/observability';
import authModule from '@so/auth';
import datasetsModule from '@so/datasets';
import connectorsModule from '../src/index.js';

const config = createConfig({
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so',
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'localhost:9000', S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin', S3_BUCKET: process.env.S3_BUCKET ?? 'so-datasets',
  ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: 'admin',
});
let server: AppServer;
afterAll(async () => { await server?.stop(); });
function cookieFrom(s: string | string[] | undefined): string { const raw = Array.isArray(s) ? s[0]! : s!; return raw.split(';')[0]!; }

describe('cloud connectors: project scoping', () => {
  it('list is scoped by X-Project', async () => {
    server = await createServer({ modules: [authModule, datasetsModule, connectorsModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();
    await server.kernel.ctx.db.query(`DELETE FROM cloud_connectors WHERE name IN ('cloudconnA','cloudconnB')`);
    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const cookie = cookieFrom(login.headers['set-cookie']);

    await server.app.inject({ method: 'POST', url: '/api/connectors-cloud/s3', headers: { cookie, 'x-project': 'projA' }, payload: { name: 'cloudconnA', s3Url: 's3://bucket/a.csv' } });
    await server.app.inject({ method: 'POST', url: '/api/connectors-cloud/s3', headers: { cookie, 'x-project': 'projB' }, payload: { name: 'cloudconnB', s3Url: 's3://bucket/b.csv' } });

    const listA = (await server.app.inject({ method: 'GET', url: '/api/connectors-cloud', headers: { cookie, 'x-project': 'projA' } })).json().connectors as Array<{ name: string }>;
    expect(listA.map((c) => c.name)).toContain('cloudconnA');
    expect(listA.map((c) => c.name)).not.toContain('cloudconnB');
  });
});
