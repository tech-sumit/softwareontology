import { describe, it, expect, afterAll } from 'vitest';
import { createServer, createConfig, type AppServer } from '@so/server';
import { createLogger } from '@so/observability';
import authModule from '@so/auth';
import datasetsModule from '@so/datasets';
import pipelinesModule from '@so/pipelines';
import ontologyModule from '@so/ontology';
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
async function cleanMarking(db: { query: (s: string, p?: unknown[]) => Promise<unknown> }, name: string) {
  await db.query(`DELETE FROM role_markings WHERE marking_id IN (SELECT id FROM markings WHERE name=$1)`, [name]);
  await db.query(`DELETE FROM dataset_markings WHERE marking_id IN (SELECT id FROM markings WHERE name=$1)`, [name]);
  await db.query(`DELETE FROM markings WHERE name=$1`, [name]);
}

describe('governance: propagation + ontology enforcement', () => {
  it('propagates markings to a pipeline output (no laundering)', async () => {
    server = await createServer({ modules: [authModule, datasetsModule, pipelinesModule, ontologyModule, governanceModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();
    await cleanMarking(server.kernel.ctx.db, 'PROVPII');
    await server.kernel.ctx.db.query(`DELETE FROM pipelines WHERE name='provpipe'`);

    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const a = { cookie: cookieFrom(login.headers['set-cookie']) };

    const ds = await server.app.inject({ method: 'POST', url: '/api/datasets?name=provin&format=csv', headers: { ...a, 'content-type': 'text/csv' }, payload: 'name,ssn\nAlice,111\nBob,222\n' });
    const inId = ds.json().dataset.id;
    const mk = await server.app.inject({ method: 'POST', url: '/api/governance/markings', headers: a, payload: { name: 'PROVPII' } });
    const mid = mk.json().id;
    await server.app.inject({ method: 'POST', url: `/api/governance/markings/${mid}/datasets/${inId}`, headers: a });

    const pipe = await server.app.inject({ method: 'POST', url: '/api/pipelines', headers: a, payload: { name: 'provpipe', inputs: ['provin'], sql: 'SELECT * FROM provin' } });
    const run = await server.app.inject({ method: 'POST', url: `/api/pipelines/${pipe.json().id}/run`, headers: a });
    const outId = run.json().datasetId;

    // the OUTPUT inherited PROVPII (propagation through the pipeline)
    const outMarks = await server.app.inject({ method: 'GET', url: `/api/governance/datasets/${outId}/markings`, headers: a });
    expect((outMarks.json().markings as Array<{ name: string }>).some((m) => m.name === 'PROVPII')).toBe(true);

    // and the admin (uncleared) cannot read the derived output — no laundering
    expect((await server.app.inject({ method: 'GET', url: `/api/datasets/${outId}/preview`, headers: a })).statusCode).toBe(403);
    await server.app.inject({ method: 'POST', url: `/api/governance/markings/${mid}/roles/role_admin`, headers: a });
    expect((await server.app.inject({ method: 'GET', url: `/api/datasets/${outId}/preview`, headers: a })).statusCode).toBe(200);
  });

  it('enforces clearance on ontology object resolution', async () => {
    await cleanMarking(server.kernel.ctx.db, 'SECRET');
    await server.kernel.ctx.db.query(`DELETE FROM object_types WHERE api_name='SecObj'`);
    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const a = { cookie: cookieFrom(login.headers['set-cookie']) };

    const ds = await server.app.inject({ method: 'POST', url: '/api/datasets?name=secdata&format=csv', headers: { ...a, 'content-type': 'text/csv' }, payload: 'code,val\nA,x\nB,y\n' });
    const secDid = ds.json().dataset.id;
    const mk = await server.app.inject({ method: 'POST', url: '/api/governance/markings', headers: a, payload: { name: 'SECRET' } });
    const mid = mk.json().id;
    await server.app.inject({ method: 'POST', url: `/api/governance/markings/${mid}/datasets/${secDid}`, headers: a });
    await server.app.inject({ method: 'POST', url: '/api/ontology/object-types', headers: a, payload: { apiName: 'SecObj', datasetId: secDid, primaryKey: 'code', properties: [{ apiName: 'code', column: 'code', type: 'string' }, { apiName: 'val', column: 'val', type: 'string' }] } });

    // resolving objects on a SECRET-marked backing dataset is denied until cleared
    expect((await server.app.inject({ method: 'GET', url: '/api/ontology/object-types/SecObj/objects', headers: a })).statusCode).toBe(403);
    await server.app.inject({ method: 'POST', url: `/api/governance/markings/${mid}/roles/role_admin`, headers: a });
    expect((await server.app.inject({ method: 'GET', url: '/api/ontology/object-types/SecObj/objects', headers: a })).statusCode).toBe(200);
  });
});
