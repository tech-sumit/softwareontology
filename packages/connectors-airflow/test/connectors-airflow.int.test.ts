import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { createServer as createHttp, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createServer, createConfig, type AppServer } from '@so/server';
import { createLogger } from '@so/observability';
import authModule from '@so/auth';
import datasetsModule from '@so/datasets';
import airflowModule from '../src/index.js';

let runner: Server; let runnerPort = 0;
beforeAll(async () => {
  runner = createHttp((req, res) => {
    req.on('data', () => {});
    req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ rows: [{ id: 1, label: 'alpha' }, { id: 2, label: 'beta' }] })); });
  });
  await new Promise<void>((r) => runner.listen(0, r)); runnerPort = (runner.address() as AddressInfo).port;
});
afterAll(async () => { await server?.stop(); await new Promise<void>((r) => runner.close(() => r())); });
function cookieFrom(s: string | string[] | undefined): string { const raw = Array.isArray(s) ? s[0]! : s!; return raw.split(';')[0]!; }
let server: AppServer;

describe('airflow connector: drives the connector-runner', () => {
  it('syncs rows from the runner into a dataset', async () => {
    const config = createConfig({
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so',
      S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'localhost:9000', S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
      S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin', S3_BUCKET: process.env.S3_BUCKET ?? 'so-datasets',
      ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: 'admin', CONNECTOR_RUNNER_URL: `http://localhost:${runnerPort}`,
    });
    server = await createServer({ modules: [authModule, datasetsModule, airflowModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();
    await server.kernel.ctx.db.query(`DELETE FROM airflow_connectors WHERE name='afconn'`);

    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const a = { cookie: cookieFrom(login.headers['set-cookie']) };
    const create = await server.app.inject({ method: 'POST', url: '/api/connectors-airflow', headers: a, payload: { name: 'afconn', provider: 'postgres', conn: 'postgresql://x', query: 'SELECT 1' } });
    expect(create.statusCode).toBe(201);
    const sync = await server.app.inject({ method: 'POST', url: `/api/connectors-airflow/${create.json().id}/sync`, headers: a });
    expect(sync.json().rowCount).toBe(2);
    const preview = await server.app.inject({ method: 'GET', url: `/api/datasets/${sync.json().datasetId}/preview`, headers: a });
    expect((preview.json().rows as Array<{ label: string }>).map((r) => r.label).sort()).toEqual(['alpha', 'beta']);
  });
});
