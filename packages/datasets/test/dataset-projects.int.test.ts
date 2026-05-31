import { describe, it, expect, afterAll } from 'vitest';
import { createServer, createConfig, type AppServer } from '@so/server';
import { createLogger } from '@so/observability';
import authModule from '@so/auth';
import datasetsModule from '../src/index.js';

const config = createConfig({
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so',
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'localhost:9000', S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin', S3_BUCKET: process.env.S3_BUCKET ?? 'so-datasets',
  ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: 'admin',
});
let server: AppServer;
afterAll(async () => { await server?.stop(); });
function cookieFrom(s: string | string[] | undefined): string { const raw = Array.isArray(s) ? s[0]! : s!; return raw.split(';')[0]!; }

describe('datasets: project scoping', () => {
  it('list is scoped by X-Project; get-by-id stays org-wide', async () => {
    server = await createServer({ modules: [authModule, datasetsModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();
    await server.kernel.ctx.db.query(`DELETE FROM dataset_columns WHERE dataset_id IN (SELECT id FROM datasets WHERE name IN ('pdataA','pdataB'))`);
    await server.kernel.ctx.db.query(`DELETE FROM datasets WHERE name IN ('pdataA','pdataB')`);

    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const cookie = cookieFrom(login.headers['set-cookie']);
    const csv = { cookie, 'content-type': 'text/csv' };

    const upA = await server.app.inject({ method: 'POST', url: '/api/datasets?name=pdataA&format=csv', headers: { ...csv, 'x-project': 'projA' }, payload: 'k,v\n1,a\n' });
    const idA = upA.json().dataset.id;
    await server.app.inject({ method: 'POST', url: '/api/datasets?name=pdataB&format=csv', headers: { ...csv, 'x-project': 'projB' }, payload: 'k,v\n2,b\n' });

    const listA = await server.app.inject({ method: 'GET', url: '/api/datasets', headers: { cookie, 'x-project': 'projA' } });
    const namesA = (listA.json().datasets as Array<{ name: string }>).map((d) => d.name);
    expect(namesA).toContain('pdataA');
    expect(namesA).not.toContain('pdataB');

    const listB = await server.app.inject({ method: 'GET', url: '/api/datasets', headers: { cookie, 'x-project': 'projB' } });
    const namesB = (listB.json().datasets as Array<{ name: string }>).map((d) => d.name);
    expect(namesB).toContain('pdataB');
    expect(namesB).not.toContain('pdataA');

    // default project (no header) sees neither projA nor projB datasets
    const listDefault = await server.app.inject({ method: 'GET', url: '/api/datasets', headers: { cookie } });
    expect((listDefault.json().datasets as Array<{ name: string }>).map((d) => d.name)).not.toContain('pdataA');

    // get-by-id is org-scoped — resolvable regardless of the active project (no header)
    const getA = await server.app.inject({ method: 'GET', url: `/api/datasets/${idA}`, headers: { cookie } });
    expect(getA.statusCode).toBe(200);
    expect(getA.json().dataset.name).toBe('pdataA');
  });
});
