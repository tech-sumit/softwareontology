import { describe, it, expect, afterAll } from 'vitest';
import { createServer, createConfig, type AppServer } from '@so/server';
import { createLogger } from '@so/observability';
import authModule from '@so/auth';
import datasetsModule from '@so/datasets';
import connectorsModule from '../src/index.js';

const PG = process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so';
const config = createConfig({
  DATABASE_URL: PG, S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'localhost:9000',
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin', S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin',
  S3_BUCKET: process.env.S3_BUCKET ?? 'so-datasets', ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: 'admin',
});

let server: AppServer;
afterAll(async () => { await server?.stop(); });
function cookieFrom(s: string | string[] | undefined): string { const raw = Array.isArray(s) ? s[0]! : s!; return raw.split(';')[0]!; }

describe('db connector: ingest an external Postgres table into a dataset', () => {
  it('creates a connector, syncs, and the dataset is queryable', async () => {
    server = await createServer({ modules: [authModule, datasetsModule, connectorsModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();
    const db = server.kernel.ctx.db;

    // a "source" table in the same Postgres + isolation
    await db.query(`DELETE FROM db_connectors WHERE name='extconn'`);
    await db.query(`DROP TABLE IF EXISTS ext_src`);
    await db.query(`CREATE TABLE ext_src (id int, label text)`);
    await db.query(`INSERT INTO ext_src(id,label) VALUES (1,'alpha'),(2,'beta'),(3,'gamma')`);

    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const auth = { cookie: cookieFrom(login.headers['set-cookie']) };

    const create = await server.app.inject({ method: 'POST', url: '/api/connectors-db', headers: auth, payload: { name: 'extconn', sourceConnString: PG, sourceTable: 'public.ext_src' } });
    expect(create.statusCode).toBe(201);
    const connId = create.json().id as string;

    const sync = await server.app.inject({ method: 'POST', url: `/api/connectors-db/${connId}/sync`, headers: auth });
    expect(sync.statusCode).toBe(200);
    expect(sync.json().rowCount).toBe(3);
    const datasetId = sync.json().datasetId as string;

    const preview = await server.app.inject({ method: 'GET', url: `/api/datasets/${datasetId}/preview`, headers: auth });
    expect(preview.statusCode).toBe(200);
    const rows = preview.json().rows as Array<{ id: number; label: string }>;
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.label).sort()).toEqual(['alpha', 'beta', 'gamma']);
  });
});
