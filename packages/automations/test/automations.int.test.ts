import { describe, it, expect, afterAll } from 'vitest';
import { createServer, createConfig, type AppServer } from '@so/server';
import { createLogger } from '@so/observability';
import authModule from '@so/auth';
import datasetsModule from '@so/datasets';
import ontologyModule from '@so/ontology';
import actionsModule from '@so/actions';
import automationsModule from '../src/index.js';

const config = createConfig({
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so',
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'localhost:9000', S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin', S3_BUCKET: process.env.S3_BUCKET ?? 'so-datasets',
  ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: 'admin',
});
const OT = 'FlightAuto';
let server: AppServer;
afterAll(async () => { await server?.stop(); });
function cookieFrom(s: string | string[] | undefined): string { const raw = Array.isArray(s) ? s[0]! : s!; return raw.split(';')[0]!; }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('automations: action triggers a follow-up action via the event bus', () => {
  it('cascades setStatus -> setNote', async () => {
    server = await createServer({ modules: [authModule, datasetsModule, ontologyModule, actionsModule, automationsModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();
    const db = server.kernel.ctx.db;
    await db.query(`DELETE FROM automations WHERE name='autonote'`);
    await db.query(`DELETE FROM action_defs WHERE api_name IN ('setStatusAuto','setNoteAuto')`);
    await db.query(`DELETE FROM object_writeback WHERE object_type=$1`, [OT]);
    await db.query(`DELETE FROM object_properties WHERE object_type_id IN (SELECT id FROM object_types WHERE org_id='org_default' AND api_name=$1)`, [OT]);
    await db.query(`DELETE FROM object_types WHERE org_id='org_default' AND api_name=$1`, [OT]);

    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const auth = { cookie: cookieFrom(login.headers['set-cookie']) };
    const up = await server.app.inject({ method: 'POST', url: '/api/datasets?name=autods&format=csv', headers: { ...auth, 'content-type': 'text/csv' }, payload: 'flight_no,status,note\nFL-1,Boarding,plain\n' });
    const datasetId = up.json().dataset.id as string;
    await server.app.inject({ method: 'POST', url: '/api/ontology/object-types', headers: auth, payload: { apiName: OT, datasetId, primaryKey: 'flightNumber', properties: [ { apiName: 'flightNumber', column: 'flight_no', type: 'string' }, { apiName: 'status', column: 'status', type: 'string' }, { apiName: 'note', column: 'note', type: 'string' } ] } });
    await server.app.inject({ method: 'POST', url: '/api/actions/definitions', headers: auth, payload: { apiName: 'setStatusAuto', objectType: OT, kind: 'modify' } });
    await server.app.inject({ method: 'POST', url: '/api/actions/definitions', headers: auth, payload: { apiName: 'setNoteAuto', objectType: OT, kind: 'modify' } });

    const auto = await server.app.inject({ method: 'POST', url: '/api/automations', headers: auth, payload: { name: 'autonote', triggerAction: 'setStatusAuto', thenAction: 'setNoteAuto', thenEdits: { note: 'auto' } } });
    expect(auto.statusCode).toBe(201);

    // execute the trigger action
    await server.app.inject({ method: 'POST', url: '/api/actions/setStatusAuto/execute', headers: auth, payload: { primaryKey: 'FL-1', edits: { status: 'Departed' } } });

    // poll for the cascaded effect (event delivery is async)
    let note: string | undefined;
    for (let i = 0; i < 40; i++) {
      const objs = await server.app.inject({ method: 'GET', url: `/api/ontology/object-types/${OT}/objects`, headers: auth });
      const fl1 = (objs.json().objects as Array<{ flightNumber: string; status: string; note: string }>).find((o) => o.flightNumber === 'FL-1');
      if (fl1?.note === 'auto') { note = fl1.note; expect(fl1.status).toBe('Departed'); break; }
      await sleep(100);
    }
    expect(note).toBe('auto');
  });
});
