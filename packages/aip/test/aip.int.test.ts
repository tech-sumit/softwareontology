import { describe, it, expect, afterAll } from 'vitest';
import { createServer, createConfig, type AppServer } from '@so/server';
import { createLogger } from '@so/observability';
import authModule from '@so/auth';
import datasetsModule from '@so/datasets';
import ontologyModule from '@so/ontology';
import aipModule from '../src/index.js';

const config = createConfig({
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so',
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'localhost:9000', S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin', S3_BUCKET: process.env.S3_BUCKET ?? 'so-datasets',
  ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: 'admin', // AIP_PROVIDER unset -> echo
});
const OT = 'AipFlight';
let server: AppServer;
afterAll(async () => { await server?.stop(); });
function cookieFrom(s: string | string[] | undefined): string { const raw = Array.isArray(s) ? s[0]! : s!; return raw.split(';')[0]!; }

describe('aip: gateway (echo) + ask over the ontology', () => {
  it('completes a prompt and answers over resolved objects', async () => {
    server = await createServer({ modules: [authModule, datasetsModule, ontologyModule, aipModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();
    const db = server.kernel.ctx.db;
    await db.query(`DELETE FROM object_properties WHERE object_type_id IN (SELECT id FROM object_types WHERE org_id='org_default' AND api_name=$1)`, [OT]);
    await db.query(`DELETE FROM object_types WHERE org_id='org_default' AND api_name=$1`, [OT]);

    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const auth = { cookie: cookieFrom(login.headers['set-cookie']) };

    const comp = await server.app.inject({ method: 'POST', url: '/api/aip/complete', headers: auth, payload: { prompt: 'ping' } });
    expect(comp.statusCode).toBe(200);
    expect(comp.json().completion).toBe('echo: ping');

    const up = await server.app.inject({ method: 'POST', url: '/api/datasets?name=aipds&format=csv', headers: { ...auth, 'content-type': 'text/csv' }, payload: 'flight_no,status\nFL-204,Delayed\n' });
    const datasetId = up.json().dataset.id as string;
    await server.app.inject({ method: 'POST', url: '/api/ontology/object-types', headers: auth, payload: { apiName: OT, datasetId, primaryKey: 'flightNumber', properties: [ { apiName: 'flightNumber', column: 'flight_no', type: 'string' }, { apiName: 'status', column: 'status', type: 'string' } ] } });

    const ask = await server.app.inject({ method: 'POST', url: '/api/aip/ask', headers: auth, payload: { objectType: OT, question: 'how many flights?' } });
    expect(ask.statusCode).toBe(200);
    const answer = ask.json().answer as string;
    expect(answer).toContain('how many flights?'); // echo of the prompt
    expect(answer).toContain('FL-204');             // the resolved object data was in the context

    const noauth = await server.app.inject({ method: 'POST', url: '/api/aip/complete', payload: { prompt: 'x' } });
    expect(noauth.statusCode).toBe(401);
  });
});
