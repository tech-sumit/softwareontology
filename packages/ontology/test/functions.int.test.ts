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
  ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: 'admin',
});

const OT = 'FlightFn';
let server: AppServer;
afterAll(async () => { await server?.stop(); });
function cookieFrom(s: string | string[] | undefined): string { const raw = Array.isArray(s) ? s[0]! : s!; return raw.split(';')[0]!; }

describe('ontology functions: computed properties', () => {
  it('resolves a computed boolean property', async () => {
    server = await createServer({ modules: [authModule, datasetsModule, ontologyModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();
    const db = server.kernel.ctx.db;
    await db.query(`DELETE FROM object_functions WHERE object_type_id IN (SELECT id FROM object_types WHERE org_id='org_default' AND api_name=$1)`, [OT]);
    await db.query(`DELETE FROM object_properties WHERE object_type_id IN (SELECT id FROM object_types WHERE org_id='org_default' AND api_name=$1)`, [OT]);
    await db.query(`DELETE FROM object_types WHERE org_id='org_default' AND api_name=$1`, [OT]);

    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const auth = { cookie: cookieFrom(login.headers['set-cookie']) };

    const up = await server.app.inject({ method: 'POST', url: '/api/datasets?name=flightsfn&format=csv', headers: { ...auth, 'content-type': 'text/csv' }, payload: 'flight_no,status\nFL-204,Delayed\nFL-118,Boarding\n' });
    const datasetId = up.json().dataset.id as string;
    await server.app.inject({ method: 'POST', url: '/api/ontology/object-types', headers: auth, payload: { apiName: OT, datasetId, primaryKey: 'flightNumber', properties: [ { apiName: 'flightNumber', column: 'flight_no', type: 'string' }, { apiName: 'status', column: 'status', type: 'string' } ] } });

    const fn = await server.app.inject({ method: 'POST', url: `/api/ontology/object-types/${OT}/functions`, headers: auth, payload: { apiName: 'isDelayed', expression: "status = 'Delayed'", type: 'bool' } });
    expect(fn.statusCode).toBe(201);

    const objs = await server.app.inject({ method: 'GET', url: `/api/ontology/object-types/${OT}/objects`, headers: auth });
    const rows = objs.json().objects as Array<{ flightNumber: string; isDelayed: boolean }>;
    expect(rows.find((r) => r.flightNumber === 'FL-204')?.isDelayed).toBe(true);
    expect(rows.find((r) => r.flightNumber === 'FL-118')?.isDelayed).toBe(false);
  });
});
