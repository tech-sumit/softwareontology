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

describe('pipeline runs: build health', () => {
  it('records a successful run and a failed run with history', async () => {
    server = await createServer({ modules: [authModule, datasetsModule, pipelinesModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();
    await server.kernel.ctx.db.query(`DELETE FROM pipelines WHERE name IN ('goodrun','badrun')`);

    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const a = { cookie: cookieFrom(login.headers['set-cookie']) };
    await server.app.inject({ method: 'POST', url: '/api/datasets?name=runflights&format=csv', headers: { ...a, 'content-type': 'text/csv' }, payload: 'flight_no,status\nFL-1,Delayed\nFL-2,Boarding\n' });

    // success
    const good = await server.app.inject({ method: 'POST', url: '/api/pipelines', headers: a, payload: { name: 'goodrun', inputs: ['runflights'], sql: "SELECT * FROM runflights WHERE status = 'Delayed'" } });
    const goodId = good.json().id;
    const goodRun = await server.app.inject({ method: 'POST', url: `/api/pipelines/${goodId}/run`, headers: a });
    expect(goodRun.statusCode).toBe(200);
    expect(goodRun.json().runId).toBeTruthy();
    const goodRuns = await server.app.inject({ method: 'GET', url: `/api/pipelines/${goodId}/runs`, headers: a });
    expect(goodRuns.json().runs).toHaveLength(1);
    expect(goodRuns.json().runs[0].status).toBe('success');
    expect(goodRuns.json().runs[0].rowCount).toBe(1);

    const oneRun = await server.app.inject({ method: 'GET', url: `/api/pipelines/runs/${goodRun.json().runId}`, headers: a });
    expect(oneRun.json().status).toBe('success');

    // failure (valid SQL, unknown column → DuckDB errors at build time)
    const bad = await server.app.inject({ method: 'POST', url: '/api/pipelines', headers: a, payload: { name: 'badrun', inputs: ['runflights'], sql: 'SELECT no_such_column FROM runflights' } });
    const badId = bad.json().id;
    const badRun = await server.app.inject({ method: 'POST', url: `/api/pipelines/${badId}/run`, headers: a });
    expect(badRun.statusCode).toBe(400);
    const badRuns = await server.app.inject({ method: 'GET', url: `/api/pipelines/${badId}/runs`, headers: a });
    expect(badRuns.json().runs[0].status).toBe('failed');
    expect(badRuns.json().runs[0].error).toBeTruthy();
  });
});
