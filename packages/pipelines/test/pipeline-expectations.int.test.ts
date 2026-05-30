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

describe('pipeline expectations: data-quality gates', () => {
  it('passes a met expectation, fails an unmet one (no dataset), rejects unknown types', async () => {
    server = await createServer({ modules: [authModule, datasetsModule, pipelinesModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();
    await server.kernel.ctx.db.query(`DELETE FROM pipelines WHERE name IN ('goodq','badq','unkq')`);

    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const a = { cookie: cookieFrom(login.headers['set-cookie']) };
    await server.app.inject({ method: 'POST', url: '/api/datasets?name=qflights&format=csv', headers: { ...a, 'content-type': 'text/csv' }, payload: 'flight_no,status\nFL-1,Delayed\nFL-2,Boarding\nFL-3,Delayed\n' });

    // PASS: row_count_min met
    const good = await server.app.inject({ method: 'POST', url: '/api/pipelines', headers: a, payload: { name: 'goodq', inputs: ['qflights'], sql: 'SELECT * FROM qflights', expectations: [{ type: 'row_count_min', value: 1 }] } });
    const goodRun = await server.app.inject({ method: 'POST', url: `/api/pipelines/${good.json().id}/run`, headers: a });
    expect(goodRun.statusCode).toBe(200);

    // FAIL: not_null violated (NULLIF makes 2 nulls) -> build fails, no dataset
    const bad = await server.app.inject({ method: 'POST', url: '/api/pipelines', headers: a, payload: { name: 'badq', inputs: ['qflights'], sql: "SELECT flight_no, NULLIF(status, 'Delayed') AS s FROM qflights", expectations: [{ type: 'not_null', column: 's' }] } });
    const badId = bad.json().id;
    const badRun = await server.app.inject({ method: 'POST', url: `/api/pipelines/${badId}/run`, headers: a });
    expect(badRun.statusCode).toBe(400);
    const runs = await server.app.inject({ method: 'GET', url: `/api/pipelines/${badId}/runs`, headers: a });
    expect(runs.json().runs[0].status).toBe('failed');
    expect(runs.json().runs[0].error).toMatch(/not_null/);
    expect(runs.json().runs[0].datasetId).toBeNull(); // no dataset registered

    // REJECT: unknown expectation type at create time
    const unk = await server.app.inject({ method: 'POST', url: '/api/pipelines', headers: a, payload: { name: 'unkq', inputs: ['qflights'], sql: 'SELECT * FROM qflights', expectations: [{ type: 'frobnicate' }] } });
    expect(unk.statusCode).toBe(400);
  });
});
