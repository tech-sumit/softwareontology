import { describe, it, expect, afterAll } from 'vitest';
import { createServer, createConfig, type AppServer } from '@so/server';
import { createLogger } from '@so/observability';
import authModule from '@so/auth';
import datasetsModule from '@so/datasets';
import pipelinesModule from '../src/index.js';

const config = createConfig({
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so',
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'localhost:9000', S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin', S3_BUCKET: process.env.S3_BUCKET ?? 'so-datasets',
  ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: 'admin',
});
let server: AppServer;
afterAll(async () => { await server?.stop(); });
function cookieFrom(s: string | string[] | undefined): string { const raw = Array.isArray(s) ? s[0]! : s!; return raw.split(';')[0]!; }

describe('incremental pipeline builds', () => {
  it('processes only new rows by watermark and appends to a stable output', async () => {
    server = await createServer({ modules: [authModule, datasetsModule, pipelinesModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();
    await server.kernel.ctx.db.query(`DELETE FROM pipelines WHERE name='incpipe'`);

    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const a = { cookie: cookieFrom(login.headers['set-cookie']) };

    // first batch of source data
    await server.app.inject({ method: 'POST', url: '/api/datasets?name=incevents&format=csv', headers: { ...a, 'content-type': 'text/csv' }, payload: 'id,val\n1,a\n2,b\n3,c\n' });
    const create = await server.app.inject({ method: 'POST', url: '/api/pipelines', headers: a, payload: { name: 'incpipe', inputs: ['incevents'], sql: 'SELECT id, val FROM incevents', incremental: true, watermarkColumn: 'id' } });
    expect(create.statusCode).toBe(201);
    const pipeId = create.json().id;

    // run 1: first run has no watermark -> processes all 3
    const run1 = await server.app.inject({ method: 'POST', url: `/api/pipelines/${pipeId}/run`, headers: a });
    expect(run1.statusCode).toBe(200);
    expect(run1.json().rowCount).toBe(3);
    const outId = run1.json().datasetId;

    // new source batch contains ONLY the new rows (id 4,5)
    await server.app.inject({ method: 'POST', url: '/api/datasets?name=incevents&format=csv', headers: { ...a, 'content-type': 'text/csv' }, payload: 'id,val\n4,d\n5,e\n' });

    // run 2: watermark=3 -> processes only id 4,5 (delta = 2), same stable output dataset
    const run2 = await server.app.inject({ method: 'POST', url: `/api/pipelines/${pipeId}/run`, headers: a });
    expect(run2.json().rowCount).toBe(2);
    expect(run2.json().datasetId).toBe(outId); // stable output across runs

    // the output ACCUMULATED to 5 rows (1..5) — a full recompute of the latest source (4,5) would be only 2
    const preview = await server.app.inject({ method: 'GET', url: `/api/datasets/${outId}/preview`, headers: a });
    const ids = (preview.json().rows as Array<{ id: number }>).map((r) => Number(r.id)).sort((x, y) => x - y);
    expect(ids).toEqual([1, 2, 3, 4, 5]);
  });
});
