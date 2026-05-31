import { describe, it, expect, afterAll } from 'vitest';
import { createServer, createConfig, type AppServer } from '@so/server';
import { createLogger } from '@so/observability';
import authModule from '@so/auth';
import datasetsModule from '@so/datasets';
import governanceModule from '../src/index.js';

const config = createConfig({
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so',
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'localhost:9000', S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin', S3_BUCKET: process.env.S3_BUCKET ?? 'so-datasets',
  ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: 'admin',
});
let server: AppServer;
afterAll(async () => { await server?.stop(); });
function cookieFrom(s: string | string[] | undefined): string { const raw = Array.isArray(s) ? s[0]! : s!; return raw.split(';')[0]!; }

describe('governance: marking-based mandatory access control', () => {
  it('denies a marked dataset until the user is cleared — even the admin', async () => {
    server = await createServer({ modules: [authModule, datasetsModule, governanceModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();
    const db = server.kernel.ctx.db;
    // deterministic start: drop any prior 'PII' marking + its grants/applies
    await db.query(`DELETE FROM role_markings WHERE marking_id IN (SELECT id FROM markings WHERE name='PII')`);
    await db.query(`DELETE FROM dataset_markings WHERE marking_id IN (SELECT id FROM markings WHERE name='PII')`);
    await db.query(`DELETE FROM markings WHERE name='PII'`);

    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const a = { cookie: cookieFrom(login.headers['set-cookie']) };

    const ds = await server.app.inject({ method: 'POST', url: '/api/datasets?name=govdata&format=csv', headers: { ...a, 'content-type': 'text/csv' }, payload: 'name,ssn\nAlice,111\nBob,222\n' });
    const did = ds.json().dataset.id;

    // unmarked -> readable
    expect((await server.app.inject({ method: 'GET', url: `/api/datasets/${did}/preview`, headers: a })).statusCode).toBe(200);

    const mk = await server.app.inject({ method: 'POST', url: '/api/governance/markings', headers: a, payload: { name: 'PII' } });
    const mid = mk.json().id;
    await server.app.inject({ method: 'POST', url: `/api/governance/markings/${mid}/datasets/${did}`, headers: a });

    // marked, admin not cleared -> 403 (mandatory access; '*' does NOT bypass)
    expect((await server.app.inject({ method: 'GET', url: `/api/datasets/${did}/preview`, headers: a })).statusCode).toBe(403);

    // grant PII to the admin role -> now cleared
    await server.app.inject({ method: 'POST', url: `/api/governance/markings/${mid}/roles/role_admin`, headers: a });
    expect((await server.app.inject({ method: 'GET', url: `/api/datasets/${did}/preview`, headers: a })).statusCode).toBe(200);

    const clr = await server.app.inject({ method: 'GET', url: '/api/governance/me/clearances', headers: a });
    expect((clr.json().clearances as Array<{ name: string }>).some((m) => m.name === 'PII')).toBe(true);
  });
});
