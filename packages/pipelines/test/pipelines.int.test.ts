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

describe('pipeline: SQL transform produces a derived dataset', () => {
  it('filters delayed flights into a new dataset', async () => {
    server = await createServer({ modules: [authModule, datasetsModule, pipelinesModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();
    await server.kernel.ctx.db.query(`DELETE FROM pipelines WHERE name='delayedout'`);

    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const auth = { cookie: cookieFrom(login.headers['set-cookie']) };

    await server.app.inject({ method: 'POST', url: '/api/datasets?name=flightspipe&format=csv', headers: { ...auth, 'content-type': 'text/csv' }, payload: 'flight_no,status,seats\nFL-204,Delayed,189\nFL-118,Boarding,142\nFL-552,Delayed,200\n' });

    const create = await server.app.inject({ method: 'POST', url: '/api/pipelines', headers: auth, payload: { name: 'delayedout', inputs: ['flightspipe'], sql: "SELECT flight_no FROM flightspipe WHERE status = 'Delayed'" } });
    expect(create.statusCode).toBe(201);
    const pid = create.json().id as string;

    const run = await server.app.inject({ method: 'POST', url: `/api/pipelines/${pid}/run`, headers: auth });
    expect(run.statusCode).toBe(200);
    expect(run.json().rowCount).toBe(2);

    const preview = await server.app.inject({ method: 'GET', url: `/api/datasets/${run.json().datasetId}/preview`, headers: auth });
    const rows = preview.json().rows as Array<{ flight_no: string }>;
    expect(rows.map((r) => r.flight_no).sort()).toEqual(['FL-204', 'FL-552']);
  });
});
