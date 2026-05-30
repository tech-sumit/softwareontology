import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { createServer as createHttp, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createServer, createConfig, type AppServer } from '@so/server';
import { createLogger } from '@so/observability';
import authModule from '@so/auth';
import datasetsModule from '@so/datasets';
import cloudModule from '../src/index.js';

const config = createConfig({
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so',
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'localhost:9000', S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin', S3_BUCKET: process.env.S3_BUCKET ?? 'so-datasets',
  ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: 'admin',
});
let server: AppServer; let rest: Server; let restPort = 0;
beforeAll(async () => { rest = createHttp((_q, r) => { r.setHeader('content-type', 'application/json'); r.end(JSON.stringify([{ id: 1, name: 'x' }, { id: 2, name: 'y' }, { id: 3, name: 'z' }])); }); await new Promise<void>((res) => rest.listen(0, res)); restPort = (rest.address() as AddressInfo).port; });
afterAll(async () => { await server?.stop(); await new Promise<void>((res) => rest.close(() => res())); });
function cookieFrom(s: string | string[] | undefined): string { const raw = Array.isArray(s) ? s[0]! : s!; return raw.split(';')[0]!; }

describe('cloud connectors: S3 file + REST JSON', () => {
  it('ingests a CSV from S3 and a JSON array from REST', async () => {
    server = await createServer({ modules: [authModule, datasetsModule, cloudModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();
    const db = server.kernel.ctx.db;
    await db.query(`DELETE FROM cloud_connectors WHERE name IN ('s3conn','restconn')`);
    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const a = { cookie: cookieFrom(login.headers['set-cookie']) };

    // put a CSV into object storage, then ingest it via the S3 connector
    const key = 'org_default/incoming/cloudtest.csv';
    await server.kernel.ctx.objectStore.putObject(key, new TextEncoder().encode('id,label\n1,a\n2,b\n'));
    const s3Url = server.kernel.ctx.objectStore.getObjectUrl(key);
    const s3c = await server.app.inject({ method: 'POST', url: '/api/connectors-cloud/s3', headers: a, payload: { name: 's3conn', s3Url, format: 'csv' } });
    const s3sync = await server.app.inject({ method: 'POST', url: `/api/connectors-cloud/${s3c.json().id}/sync`, headers: a });
    expect(s3sync.json().rowCount).toBe(2);

    // REST connector against the local test server
    const rc = await server.app.inject({ method: 'POST', url: '/api/connectors-cloud/rest', headers: a, payload: { name: 'restconn', url: `http://localhost:${restPort}/` } });
    const rsync = await server.app.inject({ method: 'POST', url: `/api/connectors-cloud/${rc.json().id}/sync`, headers: a });
    expect(rsync.json().rowCount).toBe(3);
    const preview = await server.app.inject({ method: 'GET', url: `/api/datasets/${rsync.json().datasetId}/preview`, headers: a });
    expect((preview.json().rows as Array<{ name: string }>).map((r) => r.name).sort()).toEqual(['x', 'y', 'z']);
  });
});
