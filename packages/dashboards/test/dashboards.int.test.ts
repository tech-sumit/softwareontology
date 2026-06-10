import { describe, it, expect, afterAll } from 'vitest';
import { createServer, createConfig, type AppServer } from '@so/server';
import { createLogger } from '@so/observability';
import authModule from '@so/auth';
import datasetsModule from '@so/datasets';
import ontologyModule from '@so/ontology';
import dashboardsModule from '../src/index.js';

const config = createConfig({
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so',
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'localhost:9000', S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin', S3_BUCKET: process.env.S3_BUCKET ?? 'so-datasets',
  ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: 'admin',
});
const OT = 'FlightDash';
let server: AppServer;
let auth: { cookie: string };
afterAll(async () => { await server?.stop(); });
function cookieFrom(s: string | string[] | undefined): string { const raw = Array.isArray(s) ? s[0]! : s!; return raw.split(';')[0]!; }

describe('dashboards: group-by aggregation over an object set', () => {
  it('counts flights by status', async () => {
    server = await createServer({ modules: [authModule, datasetsModule, ontologyModule, dashboardsModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();
    const db = server.kernel.ctx.db;
    await db.query(`DELETE FROM object_properties WHERE object_type_id IN (SELECT id FROM object_types WHERE org_id='org_default' AND api_name=$1)`, [OT]);
    await db.query(`DELETE FROM object_types WHERE org_id='org_default' AND api_name=$1`, [OT]);

    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    auth = { cookie: cookieFrom(login.headers['set-cookie']) };
    const up = await server.app.inject({ method: 'POST', url: '/api/datasets?name=dashds&format=csv', headers: { ...auth, 'content-type': 'text/csv' }, payload: 'flight_no,status,delay\nFL-1,Delayed,30\nFL-2,Delayed,60\nFL-3,Boarding,0\n' });
    const datasetId = up.json().dataset.id as string;
    await server.app.inject({ method: 'POST', url: '/api/ontology/object-types', headers: auth, payload: { apiName: OT, datasetId, primaryKey: 'flightNumber', properties: [ { apiName: 'flightNumber', column: 'flight_no', type: 'string' }, { apiName: 'status', column: 'status', type: 'string' }, { apiName: 'delay', column: 'delay', type: 'int' } ] } });

    const agg = await server.app.inject({ method: 'POST', url: '/api/dashboards/aggregate', headers: auth, payload: { objectType: OT, groupBy: 'status' } });
    expect(agg.statusCode).toBe(200);
    expect(agg.json().buckets).toEqual([{ group: 'Boarding', count: 1 }, { group: 'Delayed', count: 2 }]);

    const noauth = await server.app.inject({ method: 'POST', url: '/api/dashboards/aggregate', payload: { objectType: OT, groupBy: 'status' } });
    expect(noauth.statusCode).toBe(401);
  });

  it('sums and averages a numeric property per group', async () => {
    const sum = await server.app.inject({ method: 'POST', url: '/api/dashboards/aggregate', headers: auth, payload: { objectType: OT, groupBy: 'status', fn: 'sum', property: 'delay' } });
    expect(sum.statusCode).toBe(200);
    expect(sum.json().buckets).toEqual([
      { group: 'Boarding', count: 1, value: 0 },
      { group: 'Delayed', count: 2, value: 90 },
    ]);

    const avg = await server.app.inject({ method: 'POST', url: '/api/dashboards/aggregate', headers: auth, payload: { objectType: OT, groupBy: 'status', fn: 'avg', property: 'delay' } });
    expect(avg.statusCode).toBe(200);
    expect(avg.json().buckets).toEqual([
      { group: 'Boarding', count: 1, value: 0 },
      { group: 'Delayed', count: 2, value: 45 },
    ]);

    const missingProp = await server.app.inject({ method: 'POST', url: '/api/dashboards/aggregate', headers: auth, payload: { objectType: OT, groupBy: 'status', fn: 'sum' } });
    expect(missingProp.statusCode).toBe(400);
  });

  it('saves, lists, and deletes a dashboard', async () => {
    const db = server.kernel.ctx.db;
    await db.query(`DELETE FROM dashboards WHERE org_id='org_default' AND name=$1`, ['Avg delay by status']);

    const save = await server.app.inject({ method: 'POST', url: '/api/dashboards', headers: auth, payload: { name: 'Avg delay by status', objectType: OT, groupBy: 'status', fn: 'avg', property: 'delay' } });
    expect(save.statusCode).toBe(201);
    const id = save.json().id as string;

    const list = await server.app.inject({ method: 'GET', url: '/api/dashboards', headers: auth });
    expect(list.statusCode).toBe(200);
    const saved = (list.json().dashboards as Array<{ id: string; name: string; objectType: string; groupBy: string; fn: string; property: string | null }>).find((d) => d.id === id);
    expect(saved).toMatchObject({ name: 'Avg delay by status', objectType: OT, groupBy: 'status', fn: 'avg', property: 'delay' });

    const del = await server.app.inject({ method: 'DELETE', url: `/api/dashboards/${id}`, headers: auth });
    expect(del.statusCode).toBe(200);
    const after = await server.app.inject({ method: 'GET', url: '/api/dashboards', headers: auth });
    expect((after.json().dashboards as Array<{ id: string }>).some((d) => d.id === id)).toBe(false);

    const noauth = await server.app.inject({ method: 'POST', url: '/api/dashboards', payload: { name: 'x', objectType: OT, groupBy: 'status' } });
    expect(noauth.statusCode).toBe(401);
  });
});
