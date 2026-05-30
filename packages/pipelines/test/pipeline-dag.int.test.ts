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

describe('pipeline DAG: chained steps', () => {
  it('runs a 2-step pipeline where step 2 reads step 1', async () => {
    server = await createServer({ modules: [authModule, datasetsModule, pipelinesModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();
    await server.kernel.ctx.db.query(`DELETE FROM pipelines WHERE name='dagpipe'`);

    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const a = { cookie: cookieFrom(login.headers['set-cookie']) };
    await server.app.inject({ method: 'POST', url: '/api/datasets?name=flightsdag&format=csv', headers: { ...a, 'content-type': 'text/csv' }, payload: 'flight_no,status\nFL-1,Delayed\nFL-2,Boarding\nFL-3,Delayed\n' });

    const create = await server.app.inject({ method: 'POST', url: '/api/pipelines', headers: a, payload: { name: 'dagpipe', inputs: ['flightsdag'], steps: [ { name: 'delayed', sql: "SELECT flight_no FROM flightsdag WHERE status = 'Delayed'" }, { name: 'counted', sql: 'SELECT count(*)::int AS n FROM delayed' } ] } });
    expect(create.statusCode).toBe(201);

    const run = await server.app.inject({ method: 'POST', url: `/api/pipelines/${create.json().id}/run`, headers: a });
    expect(run.statusCode).toBe(200);
    expect(run.json().rowCount).toBe(1); // counted has 1 row

    const preview = await server.app.inject({ method: 'GET', url: `/api/datasets/${run.json().datasetId}/preview`, headers: a });
    expect((preview.json().rows as Array<{ n: number }>)[0]!.n).toBe(2); // 2 delayed flights
  });
});
