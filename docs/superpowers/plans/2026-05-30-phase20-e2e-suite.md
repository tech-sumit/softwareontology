# Phase 20 — End-to-End Test Suite Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps `- [ ]`.

**Goal:** A full-stack **E2E suite** (`@so/e2e`) that boots **all 12 modules** in one server and exercises the complete user journey + property-RLS + negative cases — the integration layer per-module tests don't cover.

**Architecture:** New test-only package `@so/e2e` (no `src`, devDeps on every module + `@so/server`). One `journey` test walks: upload → model → function → action (override) → automation (cascade) → dashboard → AIP → catalog/audit → lineage → connector → pipeline → admin. Separate tests cover property-RLS and auth/validation negatives. Thorough `beforeAll` cleanup makes it re-run-safe.

---

## Pre-flight
- [ ] Already on branch `phase20/e2e-and-docs` (created with `docs/IMPLEMENTED.md`). If not: `git checkout main && git checkout -b phase20/e2e-and-docs`.

---

## Task 1: `@so/e2e`

**Files:** Create `packages/e2e/{package.json,tsconfig.json,vitest.config.ts,test/journey.e2e.test.ts}`

- [ ] **Step 1: `packages/e2e/package.json`**
```json
{
  "name": "@so/e2e", "version": "0.0.0", "private": true, "type": "module",
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "devDependencies": {
    "@so/server": "workspace:*", "@so/observability": "workspace:*",
    "@so/auth": "workspace:*", "@so/datasets": "workspace:*", "@so/ontology": "workspace:*",
    "@so/actions": "workspace:*", "@so/admin": "workspace:*", "@so/connectors-db": "workspace:*",
    "@so/pipelines": "workspace:*", "@so/catalog": "workspace:*", "@so/lineage": "workspace:*",
    "@so/dashboards": "workspace:*", "@so/aip": "workspace:*", "@so/automations": "workspace:*",
    "@types/node": "^22.10.0", "@types/pg": "^8.11.0"
  }
}
```

- [ ] **Step 2: `pnpm install`**

- [ ] **Step 3: `packages/e2e/tsconfig.json`**
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "outDir": "dist", "types": ["node"] }, "include": ["test/**/*"] }
```

- [ ] **Step 4: `packages/e2e/vitest.config.ts`**
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { testTimeout: 120_000, hookTimeout: 120_000, fileParallelism: false } });
```

- [ ] **Step 5: Create `packages/e2e/test/journey.e2e.test.ts`**
```ts
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
    modules: [auth, datasets, ontology, actions, admin, connectorsDb, pipelines, catalog, lineage, dashboards, aip, automations],
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
  await db.query(`DELETE FROM action_defs WHERE api_name IN ('e2eSetStatus','e2eSetSeats')`);
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
  admCookie = await login('admin@example.com', 'admin');
});
afterAll(async () => { await server?.stop(); });

describe('E2E: full platform journey (all 12 modules)', () => {
  it('upload → model → function → action → automation → dashboard → aip → catalog → lineage → connector → pipeline → admin', async () => {
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
```

- [ ] **Step 6: Run with infra up → PASS:**
```bash
pnpm run infra:up && pnpm run infra:seed
pnpm --filter @so/e2e test
```
Expected: 3 E2E tests pass. (Bash timeout 300000 — the journey is long.) Then `pnpm --filter @so/e2e run typecheck` clean. Run it **twice** to confirm re-run safety.

> If the automation cascade poll times out, confirm all 12 modules started (event bus shared) and `e2eSetSeats` exists. If pipeline rowCount differs, remember pipelines read the **base** Parquet (overlay not applied). If RLS leaks, confirm `seats` security was set before the limited-user fetch.

- [ ] **Step 7: Commit**
```bash
git add -A && git commit -m "test(e2e): full-platform end-to-end journey + RLS + negatives (all 12 modules)"
```

---

## Task 2: Thorough verification + merge

- [ ] **Step 1: Whole suite, twice (re-run safety), checking exit codes directly (do NOT pipe pnpm test through grep):**
```bash
pnpm run infra:up && pnpm run infra:seed
pnpm typecheck; echo "tc=$?"
pnpm lint; echo "lint=$?"
pnpm test > /tmp/so-all.log 2>&1; echo "test1=$?"; grep -E "Tests +[0-9]" /tmp/so-all.log | tail -1
pnpm run infra:seed >/dev/null 2>&1
pnpm test > /tmp/so-all2.log 2>&1; echo "test2=$?"; grep -E "Tests +[0-9]" /tmp/so-all2.log | tail -1
```
All exits must be 0; both runs green.

- [ ] **Step 2:** `git add -A && git commit -m "docs: add IMPLEMENTED.md catalog"` (if the doc isn't already committed), then `git checkout main && git merge --ff-only phase20/e2e-and-docs`.

---

## Self-review
- **Coverage** — the journey hits every module's primary route through one all-modules server; RLS + negatives add masking and 401/400/404 paths. The cross-module composition (event bus, shared overlay, resolution + functions + actions) is exercised end to end. ✓
- **Re-run safe** — `beforeAll` cleans every artifact (incl. sessions before users, source table, overlay); RLS test restores `seats` security; run twice to confirm. ✓
- **Honest** — pipelines read base Parquet (not the overlay), asserted as such; AIP uses the echo provider (deterministic). ✓
- **Deferred:** Playwright browser E2E (the live browser check was done manually), load/perf testing, multi-org E2E. Flagged.
