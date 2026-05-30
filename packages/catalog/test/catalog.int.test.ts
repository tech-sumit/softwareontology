import { describe, it, expect, afterAll } from 'vitest';
import { createServer, createConfig, type AppServer } from '@so/server';
import { createLogger } from '@so/observability';
import authModule from '@so/auth';
import datasetsModule from '@so/datasets';
import ontologyModule from '@so/ontology';
import actionsModule from '@so/actions';
import catalogModule from '../src/index.js';

const config = createConfig({
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so',
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'localhost:9000', S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin', S3_BUCKET: process.env.S3_BUCKET ?? 'so-datasets',
  ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: 'admin',
});

let server: AppServer;
afterAll(async () => { await server?.stop(); });
function cookieFrom(s: string | string[] | undefined): string { const raw = Array.isArray(s) ? s[0]! : s!; return raw.split(';')[0]!; }

describe('catalog: audit + search', () => {
  it('searches names and lists audit entries', async () => {
    server = await createServer({ modules: [authModule, datasetsModule, ontologyModule, actionsModule, catalogModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();
    const db = server.kernel.ctx.db;
    // seed one audit row + a searchable dataset
    await db.query(`DELETE FROM datasets WHERE name='catalogds'`);
    await db.query(`INSERT INTO datasets(id,org_id,name,object_key,row_count) VALUES ('catds','org_default','catalogds','k',0) ON CONFLICT (id) DO NOTHING`);
    await db.query(`INSERT INTO audit_log(id,org_id,actor,action,object_type,primary_key,params) VALUES ('cataudit','org_default','admin','testAction','Widget','W1','{}') ON CONFLICT (id) DO NOTHING`);

    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const auth = { cookie: cookieFrom(login.headers['set-cookie']) };

    const search = await server.app.inject({ method: 'GET', url: '/api/catalog/search?q=catalogds', headers: auth });
    expect(search.statusCode).toBe(200);
    expect((search.json().hits as Array<{ kind: string; name: string }>)).toEqual([{ kind: 'dataset', name: 'catalogds' }]);

    const audit = await server.app.inject({ method: 'GET', url: '/api/catalog/audit?action=testAction', headers: auth });
    expect(audit.statusCode).toBe(200);
    const entries = audit.json().entries as Array<{ action: string; objectType: string }>;
    expect(entries.some((e) => e.action === 'testAction' && e.objectType === 'Widget')).toBe(true);

    const noauth = await server.app.inject({ method: 'GET', url: '/api/catalog/search?q=x' });
    expect(noauth.statusCode).toBe(401);
  });
});
