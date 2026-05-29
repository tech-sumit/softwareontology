import { describe, it, expect, afterAll } from 'vitest';
import { createServer, createConfig, type AppServer } from '@so/server';
import { createLogger } from '@so/observability';
import authModule from '@so/auth';
import datasetsModule from '@so/datasets';
import ontologyModule from '@so/ontology';
import actionsModule from '../src/index.js';

const config = createConfig({
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so',
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'localhost:9000',
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin',
  S3_BUCKET: process.env.S3_BUCKET ?? 'so-datasets',
  ADMIN_EMAIL: 'admin@example.com',
  ADMIN_PASSWORD: 'admin',
});

// Distinct object-type name so this test never collides with the ontology test's 'Flight'.
const OT = 'Flight7';

let server: AppServer;
afterAll(async () => { await server?.stop(); });

function cookieFrom(setCookie: string | string[] | undefined): string {
  const raw = Array.isArray(setCookie) ? setCookie[0]! : setCookie!;
  return raw.split(';')[0]!;
}

describe('actions: validated write-back that overrides base data', () => {
  it('executes an action and the edit shows up in resolved objects', async () => {
    server = await createServer({ modules: [authModule, datasetsModule, ontologyModule, actionsModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();

    // Deterministic isolation for this test's object type.
    const db = server.kernel.ctx.db;
    await db.query(`DELETE FROM object_writeback WHERE org_id='org_default' AND object_type=$1`, [OT]);
    await db.query(`DELETE FROM object_created WHERE org_id='org_default' AND object_type=$1`, [OT]);
    await db.query(`DELETE FROM action_defs WHERE org_id='org_default' AND api_name='setStatus'`);
    await db.query(`DELETE FROM object_properties WHERE object_type_id IN (SELECT id FROM object_types WHERE org_id='org_default' AND api_name=$1)`, [OT]);
    await db.query(`DELETE FROM object_types WHERE org_id='org_default' AND api_name=$1`, [OT]);

    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const cookie = cookieFrom(login.headers['set-cookie']);
    const auth = { cookie };

    const upload = await server.app.inject({
      method: 'POST', url: '/api/datasets?name=flights7&format=csv',
      headers: { ...auth, 'content-type': 'text/csv' },
      payload: 'flight_no,status\nFL-204,Delayed\nFL-118,Boarding\n',
    });
    const datasetId = upload.json().dataset.id as string;

    await server.app.inject({
      method: 'POST', url: '/api/ontology/object-types', headers: auth,
      payload: { apiName: OT, datasetId, primaryKey: 'flightNumber', properties: [
        { apiName: 'flightNumber', column: 'flight_no', type: 'string' },
        { apiName: 'status', column: 'status', type: 'string' },
      ] },
    });

    const defRes = await server.app.inject({
      method: 'POST', url: '/api/actions/definitions', headers: auth,
      payload: { apiName: 'setStatus', objectType: OT, kind: 'modify' },
    });
    expect(defRes.statusCode).toBe(201);

    // Before: base value from the CSV.
    const before = await server.app.inject({ method: 'GET', url: `/api/ontology/object-types/${OT}/objects`, headers: auth });
    const fl204Before = (before.json().objects as Array<{ flightNumber: string; status: string }>).find((o) => o.flightNumber === 'FL-204');
    expect(fl204Before?.status).toBe('Delayed');

    // Execute the action.
    const exec = await server.app.inject({
      method: 'POST', url: '/api/actions/setStatus/execute', headers: auth,
      payload: { primaryKey: 'FL-204', edits: { status: 'Cancelled' } },
    });
    expect(exec.statusCode).toBe(200);

    // After: overlay overrides base.
    const after = await server.app.inject({ method: 'GET', url: `/api/ontology/object-types/${OT}/objects`, headers: auth });
    const fl204After = (after.json().objects as Array<{ flightNumber: string; status: string }>).find((o) => o.flightNumber === 'FL-204');
    expect(fl204After?.status).toBe('Cancelled');

    // Audit row written.
    const audit = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM audit_log WHERE org_id='org_default' AND action='setStatus' AND primary_key='FL-204'`);
    expect((audit[0]?.n ?? 0)).toBeGreaterThanOrEqual(1);
  });

  it('rejects an unknown property and unauthenticated execution', async () => {
    const anon = await server.app.inject({ method: 'POST', url: '/api/actions/setStatus/execute', payload: { primaryKey: 'FL-204', edits: { status: 'x' } } });
    expect(anon.statusCode).toBe(401);

    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const cookie = cookieFrom(login.headers['set-cookie']);
    const bad = await server.app.inject({
      method: 'POST', url: '/api/actions/setStatus/execute', headers: { cookie },
      payload: { primaryKey: 'FL-204', edits: { nope: 'x' } },
    });
    expect(bad.statusCode).toBe(400);
  });
});
