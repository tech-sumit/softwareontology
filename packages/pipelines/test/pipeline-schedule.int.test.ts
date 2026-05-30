import { describe, it, expect, afterAll } from 'vitest';
import { createServer, createConfig, type AppServer } from '@so/server';
import { createLogger } from '@so/observability';
import authModule from '@so/auth';
import datasetsModule from '@so/datasets';
import pipelinesModule, { runDuePipelines } from '../src/index.js';

const config = createConfig({
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so',
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'localhost:9000', S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin', S3_BUCKET: process.env.S3_BUCKET ?? 'so-datasets',
  ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: 'admin',
});
let server: AppServer;
afterAll(async () => { await server?.stop(); });
function cookieFrom(s: string | string[] | undefined): string { const raw = Array.isArray(s) ? s[0]! : s!; return raw.split(';')[0]!; }

describe('pipeline scheduling', () => {
  it('sets a cron, runs a due pipeline once, and does not double-run within the period', async () => {
    server = await createServer({ modules: [authModule, datasetsModule, pipelinesModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();
    await server.kernel.ctx.db.query(`DELETE FROM pipelines WHERE name='schedpipe'`);

    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const a = { cookie: cookieFrom(login.headers['set-cookie']) };
    await server.app.inject({ method: 'POST', url: '/api/datasets?name=schedflights&format=csv', headers: { ...a, 'content-type': 'text/csv' }, payload: 'flight_no,status\nFL-1,Delayed\nFL-2,Boarding\n' });
    const create = await server.app.inject({ method: 'POST', url: '/api/pipelines', headers: a, payload: { name: 'schedpipe', inputs: ['schedflights'], sql: 'SELECT * FROM schedflights' } });
    const pipeId = create.json().id;

    // invalid cron rejected; valid cron set
    const badCron = await server.app.inject({ method: 'PUT', url: `/api/pipelines/${pipeId}/schedule`, headers: a, payload: { cron: 'not-a-cron' } });
    expect(badCron.statusCode).toBe(400);
    const setCron = await server.app.inject({ method: 'PUT', url: `/api/pipelines/${pipeId}/schedule`, headers: a, payload: { cron: '* * * * *' } });
    expect(setCron.statusCode).toBe(200);

    // run the scheduler tick logic directly with fixed clocks (no cron wait)
    const T1 = new Date('2026-05-30T12:00:30Z');
    const ran1 = await runDuePipelines(server.kernel.ctx, T1);
    expect(ran1).toContain(pipeId);

    const runs = await server.app.inject({ method: 'GET', url: `/api/pipelines/${pipeId}/runs`, headers: a });
    expect(runs.json().runs[0].trigger).toBe('schedule');
    expect(runs.json().runs[0].status).toBe('success');

    // same minute -> not due again (no double run)
    const T2 = new Date('2026-05-30T12:00:45Z');
    const ran2 = await runDuePipelines(server.kernel.ctx, T2);
    expect(ran2).not.toContain(pipeId);
  });
});
