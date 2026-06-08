import { describe, it, expect, afterAll } from 'vitest';
import { createServer, createConfig, type AppServer } from '@so/server';
import { createLogger } from '@so/observability';
import authModule from '@so/auth';
import datasetsModule from '@so/datasets';
import ontologyModule from '../src/index.js';

const config = createConfig({
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so',
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'localhost:9000',
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin',
  S3_BUCKET: process.env.S3_BUCKET ?? 'so-datasets',
  ADMIN_EMAIL: 'admin@example.com',
  ADMIN_PASSWORD: 'admin',
});

let server: AppServer;
afterAll(async () => { await server?.stop(); });

function cookieFrom(setCookie: string | string[] | undefined): string {
  const raw = Array.isArray(setCookie) ? setCookie[0]! : setCookie!;
  return raw.split(';')[0]!;
}

describe('ontology: define an object type and resolve its objects', () => {
  it('uploads a dataset, models it, and resolves live objects', async () => {
    server = await createServer({ modules: [authModule, datasetsModule, ontologyModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();

    // Test isolation: drop any prior 'Flight' object type so re-runs don't hit UNIQUE(org_id, api_name).
    await server.kernel.ctx.db.query(
      `DELETE FROM object_properties WHERE object_type_id IN (SELECT id FROM object_types WHERE org_id = 'org_default' AND api_name = 'Flight')`,
    );
    await server.kernel.ctx.db.query(`DELETE FROM object_types WHERE org_id = 'org_default' AND api_name = 'Flight'`);

    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const cookie = cookieFrom(login.headers['set-cookie']);

    const upload = await server.app.inject({
      method: 'POST', url: '/api/datasets?name=flights6&format=csv',
      headers: { cookie, 'content-type': 'text/csv' },
      payload: 'flight_no,status,seats\nFL-204,Delayed,189\nFL-118,Boarding,142\nFL-552,On time,200\n',
    });
    const datasetId = upload.json().dataset.id as string;

    const create = await server.app.inject({
      method: 'POST', url: '/api/ontology/object-types',
      headers: { cookie },
      payload: {
        apiName: 'Flight', datasetId, primaryKey: 'flightNumber',
        properties: [
          { apiName: 'flightNumber', column: 'flight_no', type: 'string' },
          { apiName: 'status', column: 'status', type: 'string' },
          { apiName: 'seats', column: 'seats', type: 'int' },
        ],
      },
    });
    expect(create.statusCode).toBe(201);

    const objs = await server.app.inject({ method: 'GET', url: '/api/ontology/object-types/Flight/objects', headers: { cookie } });
    expect(objs.statusCode).toBe(200);
    const objects = objs.json().objects as Array<{ flightNumber: string; status: string; seats: number }>;
    expect(objects).toHaveLength(3);
    const fl204 = objects.find((o) => o.flightNumber === 'FL-204');
    expect(fl204?.status).toBe('Delayed');
    expect(fl204?.seats).toBe(189);

    const list = await server.app.inject({ method: 'GET', url: '/api/ontology/object-types', headers: { cookie } });
    expect(list.json().objectTypes.some((t: { apiName: string }) => t.apiName === 'Flight')).toBe(true);
  });

  it('rejects unauthenticated resolution', async () => {
    const res = await server.app.inject({ method: 'GET', url: '/api/ontology/object-types/Flight/objects' });
    expect(res.statusCode).toBe(401);
  });

  it('branches: isolate edits, diff, and merge into main', async () => {
    const db = server.kernel.ctx.db;
    await db.query(`DELETE FROM object_writeback WHERE object_type='BR'`);
    await db.query(`DELETE FROM object_created WHERE object_type='BR'`);
    await db.query(`DELETE FROM branches WHERE name='feat1'`);
    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const cookie = cookieFrom(login.headers['set-cookie']);
    const AUTH = { cookie };
    // create a branch via the route
    expect((await server.app.inject({ method: 'POST', url: '/api/ontology/branches', headers: AUTH, payload: { name: 'feat1' } })).statusCode).toBe(201);
    // simulate an edit made on the branch (as actions.execute would)
    await db.query(`INSERT INTO object_writeback(org_id,object_type,primary_key,property,value,version,branch,updated_by) VALUES ('org_default','BR','k1','status','Delayed',1,'feat1','t')`);
    // diff shows the branch's edit
    const diff = (await server.app.inject({ method: 'GET', url: '/api/ontology/branches/feat1/diff', headers: AUTH })).json();
    expect(diff.edits.some((e: { primaryKey: string; value: string }) => e.primaryKey === 'k1' && e.value === 'Delayed')).toBe(true);
    // main has no such writeback row yet
    const mainBefore = await db.query(`SELECT 1 FROM object_writeback WHERE object_type='BR' AND primary_key='k1' AND branch='main'`);
    expect(mainBefore.length).toBe(0);
    // merge → main now carries the edit; branch marked merged
    const m = (await server.app.inject({ method: 'POST', url: '/api/ontology/branches/feat1/merge', headers: AUTH })).json();
    expect(m.merged).toBeGreaterThan(0);
    const mainAfter = await db.query(`SELECT value FROM object_writeback WHERE object_type='BR' AND primary_key='k1' AND branch='main'`);
    expect(mainAfter.length).toBe(1);
    const branches = (await server.app.inject({ method: 'GET', url: '/api/ontology/branches', headers: AUTH })).json().branches as Array<{ name: string; status: string }>;
    expect(branches.find((b) => b.name === 'feat1')?.status).toBe('merged');
    expect(branches.find((b) => b.name === 'main')).toBeTruthy();
  });
});
