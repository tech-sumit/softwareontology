import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createServer, createConfig, type AppServer } from '@so/server';
import { createLogger } from '@so/observability';
import auth, { hashPassword } from '@so/auth';
import datasets from '@so/datasets';
import ontology from '@so/ontology';
import actions from '@so/actions';
import admin from '@so/admin';
import connectorsDb from '@so/connectors-db';
import pipelines from '@so/pipelines';
import catalog from '@so/catalog';
import lineage from '@so/lineage';
import dashboards from '@so/dashboards';
import aip from '@so/aip';
import automations from '@so/automations';
import governance from '@so/governance';

const PG = process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so';
const config = createConfig({
  DATABASE_URL: PG, S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'localhost:9000',
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin', S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin',
  S3_BUCKET: process.env.S3_BUCKET ?? 'so-datasets', ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: 'admin',
});

const OT = 'E2EFlight';
let server: AppServer;
let admCookie: string;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function cookieFrom(s: string | string[] | undefined): string { const raw = Array.isArray(s) ? s[0]! : s!; return raw.split(';')[0]!; }
async function login(email: string, password: string): Promise<string> {
  const r = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  return cookieFrom(r.headers['set-cookie']);
}
async function objects(cookie: string): Promise<Array<Record<string, unknown>>> {
  const r = await server.app.inject({ method: 'GET', url: `/api/ontology/object-types/${OT}/objects`, headers: { cookie } });
  return r.json().objects as Array<Record<string, unknown>>;
}

beforeAll(async () => {
  server = await createServer({
    modules: [auth, datasets, ontology, actions, admin, connectorsDb, pipelines, catalog, lineage, dashboards, aip, automations, governance],
    logger: createLogger(), config,
  });
  await server.kernel.start();
  await server.app.ready();
  const db = server.kernel.ctx.db;
  // thorough isolation
  await db.query(`DELETE FROM object_writeback WHERE object_type=$1`, [OT]);
  await db.query(`DELETE FROM object_created WHERE object_type=$1`, [OT]);
  await db.query(`DELETE FROM object_functions WHERE object_type_id IN (SELECT id FROM object_types WHERE org_id='org_default' AND api_name=$1)`, [OT]);
  await db.query(`DELETE FROM object_properties WHERE object_type_id IN (SELECT id FROM object_types WHERE org_id='org_default' AND api_name=$1)`, [OT]);
  await db.query(`DELETE FROM object_types WHERE org_id='org_default' AND api_name=$1`, [OT]);
  // governance H1: object type backed by the marked dataset (created in the journey test)
  await db.query(`DELETE FROM object_properties WHERE object_type_id IN (SELECT id FROM object_types WHERE org_id='org_default' AND api_name='E2EGovMarked')`);
  await db.query(`DELETE FROM object_types WHERE org_id='org_default' AND api_name='E2EGovMarked'`);
  await db.query(`DELETE FROM action_defs WHERE api_name IN ('e2eSetStatus','e2eSetSeats')`);
  await db.query(`DELETE FROM branches WHERE name='wip'`);
  await db.query(`DELETE FROM automations WHERE name='e2eauto'`);
  await db.query(`DELETE FROM db_connectors WHERE name='e2econn'`);
  await db.query(`DELETE FROM pipelines WHERE name='e2epipe'`);
  await db.query(`DROP TABLE IF EXISTS e2e_src`);
  for (const email of ['e2euser@example.com', 'e2elimited@example.com']) {
    await db.query(`DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE email=$1)`, [email]);
    await db.query(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email=$1)`, [email]);
    await db.query(`DELETE FROM users WHERE email=$1`, [email]);
  }
  await db.query(`DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE name='e2elimitedrole')`);
  await db.query(`DELETE FROM roles WHERE name='e2elimitedrole'`);
  await db.query(`DELETE FROM role_markings WHERE marking_id IN (SELECT id FROM markings WHERE name='E2EMARK')`);
  await db.query(`DELETE FROM dataset_markings WHERE marking_id IN (SELECT id FROM markings WHERE name='E2EMARK')`);
  await db.query(`DELETE FROM markings WHERE name='E2EMARK'`);
  await db.query(`DELETE FROM pipelines WHERE name='e2egovpipe'`);
  admCookie = await login('admin@example.com', 'admin');
});
afterAll(async () => { await server?.stop(); });

describe('E2E: full platform journey (all 13 modules)', () => {
  it('upload → model → function → action → automation → dashboard → aip → catalog → lineage → connector → pipeline → admin → governance', async () => {
    const a = { cookie: admCookie };

    // 1. upload + model + computed function
    const up = await server.app.inject({ method: 'POST', url: '/api/datasets?name=e2eds&format=csv', headers: { ...a, 'content-type': 'text/csv' }, payload: 'flight_no,status,seats\nFL-1,Delayed,100\nFL-2,Boarding,200\nFL-3,Delayed,150\n' });
    expect(up.statusCode).toBe(201);
    const datasetId = up.json().dataset.id as string;
    expect((await server.app.inject({ method: 'POST', url: '/api/ontology/object-types', headers: a, payload: { apiName: OT, datasetId, primaryKey: 'flightNumber', properties: [ { apiName: 'flightNumber', column: 'flight_no', type: 'string' }, { apiName: 'status', column: 'status', type: 'string' }, { apiName: 'seats', column: 'seats', type: 'int' } ] } })).statusCode).toBe(201);
    expect((await server.app.inject({ method: 'POST', url: `/api/ontology/object-types/${OT}/functions`, headers: a, payload: { apiName: 'isDelayed', expression: "status = 'Delayed'", type: 'bool' } })).statusCode).toBe(201);
    let rows = await objects(admCookie);
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.flightNumber === 'FL-1')).toMatchObject({ status: 'Delayed', seats: 100, isDelayed: true });
    expect(rows.find((r) => r.flightNumber === 'FL-2')?.isDelayed).toBe(false);

    // 2. action overrides base
    await server.app.inject({ method: 'POST', url: '/api/actions/definitions', headers: a, payload: { apiName: 'e2eSetStatus', objectType: OT, kind: 'modify' } });
    await server.app.inject({ method: 'POST', url: '/api/actions/definitions', headers: a, payload: { apiName: 'e2eSetSeats', objectType: OT, kind: 'modify' } });
    await server.app.inject({ method: 'POST', url: '/api/actions/e2eSetStatus/execute', headers: a, payload: { primaryKey: 'FL-2', edits: { status: 'Cancelled' } } });
    rows = await objects(admCookie);
    expect(rows.find((r) => r.flightNumber === 'FL-2')?.status).toBe('Cancelled');

    // 3. automation cascade: setStatus -> setSeats
    expect((await server.app.inject({ method: 'POST', url: '/api/automations', headers: a, payload: { name: 'e2eauto', triggerAction: 'e2eSetStatus', thenAction: 'e2eSetSeats', thenEdits: { seats: 999 } } })).statusCode).toBe(201);
    await server.app.inject({ method: 'POST', url: '/api/actions/e2eSetStatus/execute', headers: a, payload: { primaryKey: 'FL-1', edits: { status: 'Departed' } } });
    let fl1Seats: unknown;
    for (let i = 0; i < 50; i++) {
      const r = (await objects(admCookie)).find((o) => o.flightNumber === 'FL-1');
      if (r?.seats === 999) { fl1Seats = r.seats; expect(r.status).toBe('Departed'); break; }
      await sleep(100);
    }
    expect(fl1Seats).toBe(999);

    // 4. dashboards aggregate by status -> Cancelled/Delayed/Departed each 1
    const agg = await server.app.inject({ method: 'POST', url: '/api/dashboards/aggregate', headers: a, payload: { objectType: OT, groupBy: 'status' } });
    expect(agg.json().buckets).toEqual([{ group: 'Cancelled', count: 1 }, { group: 'Delayed', count: 1 }, { group: 'Departed', count: 1 }]);

    // 5. AIP ask over the ontology (echo)
    const ask = await server.app.inject({ method: 'POST', url: '/api/aip/ask', headers: a, payload: { objectType: OT, question: 'how many?' } });
    expect(ask.statusCode).toBe(200);
    expect(ask.json().answer).toContain(OT);
    expect(ask.json().answer).toContain('how many?');

    // 5b. AIP semantic search: index the object type then search by meaning (echo = deterministic hash embedding)
    const idx = await server.app.inject({ method: 'POST', url: '/api/aip/index', headers: a, payload: { objectType: OT } });
    expect(idx.statusCode).toBe(200);
    expect(idx.json().indexed).toBeGreaterThan(0);
    const sr = await server.app.inject({ method: 'POST', url: '/api/aip/search', headers: a, payload: { objectType: OT, query: 'Delayed' } });
    expect(sr.statusCode).toBe(200);
    const results = sr.json().results as Array<{ primaryKey: string; score: number }>;
    expect(results.length).toBeGreaterThan(0);
    expect(typeof results[0]!.score).toBe('number');

    // 5c. AIP agent: picks tools over the ontology; under echo it falls back to semantic search of the referenced type
    const ag = await server.app.inject({ method: 'POST', url: '/api/aip/agent', headers: a, payload: { question: 'Which E2EFlight are Delayed?' } });
    expect(ag.statusCode).toBe(200);
    const aj = ag.json() as { answer: string; steps: Array<{ tool: string }> };
    expect(typeof aj.answer).toBe('string');
    expect(aj.answer.length).toBeGreaterThan(0);
    expect(aj.steps.some((s) => s.tool === 'search')).toBe(true);

    // 6. catalog search + audit
    const search = await server.app.inject({ method: 'GET', url: `/api/catalog/search?q=${OT}`, headers: a });
    expect((search.json().hits as Array<{ kind: string; name: string }>)).toContainEqual({ kind: 'objectType', name: OT });
    const audit = await server.app.inject({ method: 'GET', url: '/api/catalog/audit?action=e2eSetStatus', headers: a });
    expect((audit.json().entries as Array<{ action: string }>).some((e) => e.action === 'e2eSetStatus')).toBe(true);

    // 7. lineage
    const lin = await server.app.inject({ method: 'GET', url: `/api/lineage/object-types/${OT}`, headers: a });
    expect(lin.json().lineage.backingDataset).toBe('e2eds');
    expect(lin.json().lineage.actions).toEqual(expect.arrayContaining(['e2eSetStatus', 'e2eSetSeats']));

    // 8. connector ingests an external Postgres table
    const db = server.kernel.ctx.db;
    await db.query(`CREATE TABLE e2e_src (id int, label text)`);
    await db.query(`INSERT INTO e2e_src(id,label) VALUES (1,'x'),(2,'y')`);
    const conn = await server.app.inject({ method: 'POST', url: '/api/connectors-db', headers: a, payload: { name: 'e2econn', sourceConnString: PG, sourceTable: 'public.e2e_src' } });
    const sync = await server.app.inject({ method: 'POST', url: `/api/connectors-db/${conn.json().id}/sync`, headers: a });
    expect(sync.json().rowCount).toBe(2);

    // 9. pipeline transforms the base dataset (reads base Parquet)
    const pipe = await server.app.inject({ method: 'POST', url: '/api/pipelines', headers: a, payload: { name: 'e2epipe', inputs: ['e2eds'], sql: "SELECT flight_no FROM e2eds WHERE status = 'Delayed'" } });
    const run = await server.app.inject({ method: 'POST', url: `/api/pipelines/${pipe.json().id}/run`, headers: a });
    expect(run.json().rowCount).toBe(2); // base FL-1 + FL-3 (overlay not applied to pipelines)

    // 10. admin creates a user
    const created = await server.app.inject({ method: 'POST', url: '/api/admin/users', headers: a, payload: { email: 'e2euser@example.com', password: 'pw' } });
    expect(created.statusCode).toBe(201);
    const users = await server.app.inject({ method: 'GET', url: '/api/admin/users', headers: a });
    expect((users.json().users as Array<{ email: string }>).some((u) => u.email === 'e2euser@example.com')).toBe(true);

    // N. governance: markings → mandatory access control → propagation
    const govUp = await server.app.inject({ method: 'POST', url: '/api/datasets?name=e2egov&format=csv', headers: { ...a, 'content-type': 'text/csv' }, payload: 'k,v\n1,a\n2,b\n' });
    const govDid = govUp.json().dataset.id as string;
    const mk = await server.app.inject({ method: 'POST', url: '/api/governance/markings', headers: a, payload: { name: 'E2EMARK' } });
    const mid = mk.json().id as string;
    await server.app.inject({ method: 'POST', url: `/api/governance/markings/${mid}/datasets/${govDid}`, headers: a });
    // mandatory access: even the admin is denied until cleared
    expect((await server.app.inject({ method: 'GET', url: `/api/datasets/${govDid}/preview`, headers: a })).statusCode).toBe(403);
    // H1: dashboards + AIP must ALSO inherit the marking via resolveObjects — back an
    // object type with the marked-but-uncleared dataset and prove the bypassing surfaces 403.
    const MARKED_OT = 'E2EGovMarked';
    expect((await server.app.inject({ method: 'POST', url: '/api/ontology/object-types', headers: a, payload: { apiName: MARKED_OT, datasetId: govDid, primaryKey: 'k', properties: [ { apiName: 'k', column: 'k', type: 'string' }, { apiName: 'v', column: 'v', type: 'string' } ] } })).statusCode).toBe(201);
    // dashboards must not bypass the marking
    const govAgg = await server.app.inject({ method: 'POST', url: '/api/dashboards/aggregate', headers: a, payload: { objectType: MARKED_OT, groupBy: 'v' } });
    expect(govAgg.statusCode).toBe(403);
    // AIP search must not bypass it either
    const govSr = await server.app.inject({ method: 'POST', url: '/api/aip/search', headers: a, payload: { objectType: MARKED_OT, query: 'x' } });
    expect([400, 403]).toContain(govSr.statusCode);
    await server.app.inject({ method: 'POST', url: `/api/governance/markings/${mid}/roles/role_admin`, headers: a });
    expect((await server.app.inject({ method: 'GET', url: `/api/datasets/${govDid}/preview`, headers: a })).statusCode).toBe(200);
    // propagation: a derived dataset inherits the source marking
    const gp = await server.app.inject({ method: 'POST', url: '/api/pipelines', headers: a, payload: { name: 'e2egovpipe', inputs: ['e2egov'], sql: 'SELECT * FROM e2egov' } });
    const gr = await server.app.inject({ method: 'POST', url: `/api/pipelines/${gp.json().id}/run`, headers: a });
    const om = await server.app.inject({ method: 'GET', url: `/api/governance/datasets/${gr.json().datasetId}/markings`, headers: a });
    expect((om.json().markings as Array<{ name: string }>).some((m) => m.name === 'E2EMARK')).toBe(true);

    // O. branching: edits on a branch are isolated from main, then merge into main
    const PK = 'FL-2';
    const PK_PROP = 'flightNumber';
    await server.app.inject({ method: 'POST', url: '/api/ontology/branches', headers: a, payload: { name: 'wip' } });
    const branchAuth = { ...a, 'x-branch': 'wip' };
    await server.app.inject({ method: 'POST', url: '/api/actions/e2eSetStatus/execute', headers: branchAuth, payload: { primaryKey: PK, edits: { status: 'BranchOnly' } } });
    // main is unchanged; branch sees the edit
    const onMain = await server.app.inject({ method: 'GET', url: `/api/ontology/object-types/${OT}/objects`, headers: a });
    const onBranch = await server.app.inject({ method: 'GET', url: `/api/ontology/object-types/${OT}/objects`, headers: branchAuth });
    const findStatus = (resp: typeof onMain) => ((resp.json().objects as Array<Record<string, unknown>>).find((o) => String(o[PK_PROP]) === PK)?.status);
    expect(findStatus(onBranch)).toBe('BranchOnly');
    expect(findStatus(onMain)).not.toBe('BranchOnly');
    // merge → main now reflects it
    await server.app.inject({ method: 'POST', url: '/api/ontology/branches/wip/merge', headers: a });
    const onMainAfter = await server.app.inject({ method: 'GET', url: `/api/ontology/object-types/${OT}/objects`, headers: a });
    expect(findStatus(onMainAfter)).toBe('BranchOnly');
  });

  it('property-level RLS masks a secured property for a limited user', async () => {
    const a = { cookie: admCookie };
    await server.app.inject({ method: 'POST', url: `/api/ontology/object-types/${OT}/properties/seats/security`, headers: a, payload: { requiredPermission: 'pii:view' } });
    // admin sees seats
    expect((await objects(admCookie)).find((r) => r.flightNumber === 'FL-3')).toHaveProperty('seats');
    // limited user (ontology:read only)
    const db = server.kernel.ctx.db;
    const roleId = randomUUID(); const userId = randomUUID();
    await db.query(`INSERT INTO roles(id,org_id,name) VALUES ($1,'org_default','e2elimitedrole')`, [roleId]);
    await db.query(`INSERT INTO permissions(key) VALUES ('ontology:read') ON CONFLICT DO NOTHING`);
    await db.query(`INSERT INTO role_permissions(role_id,permission_key) VALUES ($1,'ontology:read')`, [roleId]);
    await db.query(`INSERT INTO users(id,org_id,email,password_hash) VALUES ($1,'org_default','e2elimited@example.com',$2)`, [userId, hashPassword('pw')]);
    await db.query(`INSERT INTO user_roles(user_id,role_id) VALUES ($1,$2)`, [userId, roleId]);
    const limCookie = await login('e2elimited@example.com', 'pw');
    const lrows = await objects(limCookie);
    const fl3 = lrows.find((r) => r.flightNumber === 'FL-3')!;
    expect(fl3.status).toBe('Delayed');     // unsecured visible
    expect('seats' in fl3).toBe(false);      // secured masked
    // restore (so other assertions/runs aren't affected)
    await server.app.inject({ method: 'POST', url: `/api/ontology/object-types/${OT}/properties/seats/security`, headers: a, payload: { requiredPermission: null } });
  });

  it('rejects unauthenticated, malformed, and not-found requests', async () => {
    expect((await server.app.inject({ method: 'GET', url: `/api/ontology/object-types/${OT}/objects` })).statusCode).toBe(401);
    const a = { cookie: admCookie };
    expect((await server.app.inject({ method: 'POST', url: '/api/datasets?format=csv', headers: { ...a, 'content-type': 'text/csv' }, payload: 'x' })).statusCode).toBe(400); // missing name
    expect((await server.app.inject({ method: 'GET', url: '/api/ontology/object-types/DoesNotExist', headers: a })).statusCode).toBe(404);
    const badLogin = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'nope' } });
    expect(badLogin.statusCode).toBe(401);
  });
});
