import { describe, it, expect, afterAll } from 'vitest';
import { createServer, createConfig, type AppServer } from '@so/server';
import { createLogger } from '@so/observability';
import authModule from '@so/auth';
import datasetsModule from '@so/datasets';
import connectorsModule from '../src/index.js';

const PG = process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so';
const config = createConfig({
  DATABASE_URL: PG, S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'localhost:9000',
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin', S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin',
  S3_BUCKET: process.env.S3_BUCKET ?? 'so-datasets', ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: 'admin',
});
let server: AppServer;
afterAll(async () => { await server?.stop(); });
function cookieFrom(s: string | string[] | undefined): string { const raw = Array.isArray(s) ? s[0]! : s!; return raw.split(';')[0]!; }

describe('db connectors: project scoping', () => {
  it('list is scoped by X-Project', async () => {
    server = await createServer({ modules: [authModule, datasetsModule, connectorsModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();
    await server.kernel.ctx.db.query(`DELETE FROM db_connectors WHERE name IN ('dbconnA','dbconnB')`);
    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const cookie = cookieFrom(login.headers['set-cookie']);

    await server.app.inject({ method: 'POST', url: '/api/connectors-db', headers: { cookie, 'x-project': 'projA' }, payload: { name: 'dbconnA', sourceConnString: PG, sourceTable: 'public.dbconnA_src' } });
    await server.app.inject({ method: 'POST', url: '/api/connectors-db', headers: { cookie, 'x-project': 'projB' }, payload: { name: 'dbconnB', sourceConnString: PG, sourceTable: 'public.dbconnB_src' } });

    const listA = (await server.app.inject({ method: 'GET', url: '/api/connectors-db', headers: { cookie, 'x-project': 'projA' } })).json().connectors as Array<{ name: string }>;
    expect(listA.map((c) => c.name)).toContain('dbconnA');
    expect(listA.map((c) => c.name)).not.toContain('dbconnB');
  });
});
