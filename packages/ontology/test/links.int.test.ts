import { describe, it, expect, afterAll } from 'vitest';
import { createServer, createConfig, type AppServer } from '@so/server';
import { createLogger } from '@so/observability';
import authModule from '@so/auth';
import datasetsModule from '@so/datasets';
import ontologyModule from '../src/index.js';

const config = createConfig({
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so',
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'localhost:9000', S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin', S3_BUCKET: process.env.S3_BUCKET ?? 'so-datasets',
  ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: 'admin',
});
const FT = 'FlightLink'; const AT = 'AircraftLink';
let server: AppServer;
afterAll(async () => { await server?.stop(); });
function cookieFrom(s: string | string[] | undefined): string { const raw = Array.isArray(s) ? s[0]! : s!; return raw.split(';')[0]!; }

describe('ontology link traversal: Flight -> Aircraft', () => {
  it('resolves the linked object via the foreign-key property', async () => {
    server = await createServer({ modules: [authModule, datasetsModule, ontologyModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();
    const db = server.kernel.ctx.db;
    for (const t of [FT, AT]) {
      await db.query(`DELETE FROM link_types WHERE org_id='org_default' AND (from_object_type_id IN (SELECT id FROM object_types WHERE api_name=$1) OR to_object_type_id IN (SELECT id FROM object_types WHERE api_name=$1))`, [t]);
    }
    for (const t of [FT, AT]) {
      await db.query(`DELETE FROM object_properties WHERE object_type_id IN (SELECT id FROM object_types WHERE org_id='org_default' AND api_name=$1)`, [t]);
      await db.query(`DELETE FROM object_types WHERE org_id='org_default' AND api_name=$1`, [t]);
    }

    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const a = { cookie: cookieFrom(login.headers['set-cookie']) };

    const ad = await server.app.inject({ method: 'POST', url: '/api/datasets?name=aircraftds&format=csv', headers: { ...a, 'content-type': 'text/csv' }, payload: 'tail_no,model\nN1,A320\nN2,B737\n' });
    await server.app.inject({ method: 'POST', url: '/api/ontology/object-types', headers: a, payload: { apiName: AT, datasetId: ad.json().dataset.id, primaryKey: 'tailNumber', properties: [ { apiName: 'tailNumber', column: 'tail_no', type: 'string' }, { apiName: 'model', column: 'model', type: 'string' } ] } });

    const fd = await server.app.inject({ method: 'POST', url: '/api/datasets?name=flightlinkds&format=csv', headers: { ...a, 'content-type': 'text/csv' }, payload: 'flight_no,status,tail_no\nFL-1,Delayed,N1\nFL-2,Boarding,N2\n' });
    await server.app.inject({ method: 'POST', url: '/api/ontology/object-types', headers: a, payload: { apiName: FT, datasetId: fd.json().dataset.id, primaryKey: 'flightNumber', properties: [ { apiName: 'flightNumber', column: 'flight_no', type: 'string' }, { apiName: 'status', column: 'status', type: 'string' }, { apiName: 'tailNo', column: 'tail_no', type: 'string' } ] } });

    const link = await server.app.inject({ method: 'POST', url: '/api/ontology/link-types', headers: a, payload: { apiName: 'aircraft', fromObjectType: FT, toObjectType: AT, foreignKeyProperty: 'tailNo' } });
    expect(link.statusCode).toBe(201);

    const linked = await server.app.inject({ method: 'GET', url: `/api/ontology/object-types/${FT}/objects/FL-1/links/aircraft`, headers: a });
    expect(linked.statusCode).toBe(200);
    const objs = linked.json().objects as Array<{ tailNumber: string; model: string }>;
    expect(objs).toHaveLength(1);
    expect(objs[0]).toMatchObject({ tailNumber: 'N1', model: 'A320' });

    const noauth = await server.app.inject({ method: 'GET', url: `/api/ontology/object-types/${FT}/objects/FL-1/links/aircraft` });
    expect(noauth.statusCode).toBe(401);
  });
});
