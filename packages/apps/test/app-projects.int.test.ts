import { describe, it, expect, afterAll } from 'vitest';
import { createServer, createConfig, type AppServer } from '@so/server';
import { createLogger } from '@so/observability';
import authModule from '@so/auth';
import appsModule from '../src/index.js';

const config = createConfig({
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so',
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'localhost:9000', S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin', S3_BUCKET: process.env.S3_BUCKET ?? 'so-datasets',
  ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: 'admin',
});
let server: AppServer;
afterAll(async () => { await server?.stop(); });
function cookieFrom(s: string | string[] | undefined): string { const raw = Array.isArray(s) ? s[0]! : s!; return raw.split(';')[0]!; }

describe('apps: project scoping', () => {
  it('list is scoped by X-Project', async () => {
    server = await createServer({ modules: [authModule, appsModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();
    await server.kernel.ctx.db.query(`DELETE FROM apps WHERE name IN ('appA','appB')`);
    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const cookie = cookieFrom(login.headers['set-cookie']);

    await server.app.inject({ method: 'POST', url: '/api/apps', headers: { cookie, 'x-project': 'projA' }, payload: { name: 'appA', definition: { widgets: [] } } });
    await server.app.inject({ method: 'POST', url: '/api/apps', headers: { cookie, 'x-project': 'projB' }, payload: { name: 'appB', definition: { widgets: [] } } });

    const listA = (await server.app.inject({ method: 'GET', url: '/api/apps', headers: { cookie, 'x-project': 'projA' } })).json().apps as Array<{ name: string }>;
    expect(listA.map((a) => a.name)).toContain('appA');
    expect(listA.map((a) => a.name)).not.toContain('appB');
  });
});
