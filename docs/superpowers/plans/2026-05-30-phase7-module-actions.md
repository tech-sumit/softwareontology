# Phase 7 — module-actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `@so/actions` — define validated **Actions** against an Object Type and execute them with **ACID write-back** to the overlay (`object_writeback` for edits, `object_created` for new objects) plus an audit record. The payoff: run an action that edits a property and watch the change **override the base value** in resolved objects — closing the read+write loop the resolver proved in Plan 1.

**Architecture:** Adds `Db.transaction()` to the SDK (implemented in `@so/server` via a pooled client `BEGIN/COMMIT/ROLLBACK`) so write-back is atomic. `@so/actions` (dependsOn `ontology`, `auth`) stores action definitions, validates execution params against the target Object Type's properties (via `@so/ontology`), writes overlay rows + an `audit_log` row in one transaction, and emits `action.executed`. Routes are auth-protected.

**Tech Stack:** TypeScript, `pg` transactions, `@so/ontology` (object-type lookup/validation), `@so/auth` (guard); integration-tested via `@so/server` against Docker Postgres + MinIO.

---

## Pre-flight

- [ ] **Branch:** `cd /Users/sumitagrawal/CODE/sumit/SoftwareOntology && git checkout main && git checkout -b phase7/module-actions`

---

## File structure

```
packages/sdk/      (modified) add transaction() to Db interface; fake ctx db impl
packages/server/   (modified) createDb implements transaction()
packages/actions/  (new) @so/actions
  package.json     dep: @so/sdk @so/auth @so/ontology fastify ; devDep: @so/server @so/observability @so/datasets @types/node @types/pg
  tsconfig.json
  vitest.config.ts
  src/migrate.ts   action_defs, audit_log
  src/service.ts   createActionService(ctx): createActionDef/list/execute (transactional)
  src/routes.ts    actionRoutes (protected)
  src/index.ts     defineModule({ id:'actions', dependsOn:['ontology','auth'], ... })
  test/actions.int.test.ts   define action → execute → resolved object reflects the edit
```

---

## Task 1: `Db.transaction` (SDK interface + server impl + fake)

**Files:** Modify `packages/sdk/src/types.ts`, `packages/sdk/src/testing.ts`, `packages/server/src/services/db.ts`, `packages/server/test/services.int.test.ts`

- [ ] **Step 1: Add `transaction` to the `Db` interface — modify `packages/sdk/src/types.ts`**

Replace the `Db` interface with:
```ts
export interface Db {
  query<R = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<R[]>;
  /** Run fn inside a single-connection transaction (BEGIN/COMMIT, ROLLBACK on throw). */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
}
```

- [ ] **Step 2: Update the fake db — modify `packages/sdk/src/testing.ts`**

In `createFakeContext`, replace the inline `db: { query: async () => [] }` in `base` with a named fake that satisfies the new interface. Add, before `const base`:
```ts
  const fakeDb: import('./types.js').Db = {
    query: async () => [],
    transaction: (fn) => fn(fakeDb),
  };
```
and in `base`, set `db: fakeDb,`.

- [ ] **Step 3: Implement `transaction` — modify `packages/server/src/services/db.ts`**

Replace the file with:
```ts
import { Pool, type PoolClient } from 'pg';
import type { Db, Config } from '@so/sdk';

export interface DbService extends Db {
  pool: Pool;
  close(): Promise<void>;
}

function clientDb(client: PoolClient): Db {
  const db: Db = {
    async query<R = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<R[]> {
      const res = await client.query(sql, params as unknown[] | undefined);
      return res.rows as R[];
    },
    transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      return fn(db); // nested transaction joins the current one
    },
  };
  return db;
}

export function createDb(config: Config): DbService {
  const pool = new Pool({ connectionString: config.require('DATABASE_URL') });
  return {
    pool,
    async query<R = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<R[]> {
      const res = await pool.query(sql, params as unknown[] | undefined);
      return res.rows as R[];
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(clientDb(client));
        await client.query('COMMIT');
        return result;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}
```

- [ ] **Step 4: Add transaction tests — append to `packages/server/test/services.int.test.ts`**

```ts
describe('db.transaction', () => {
  it('commits successful work', async () => {
    const rows = await db.transaction(async (tx) => tx.query<{ n: number }>('SELECT 7::int AS n'));
    expect(rows[0]?.n).toBe(7);
  });

  it('rolls back and rethrows on error', async () => {
    await expect(db.transaction(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
  });
});
```

- [ ] **Step 5: Verify (infra up)**

```bash
pnpm run infra:up
pnpm --filter @so/sdk test && pnpm --filter @so/server test
pnpm --filter @so/sdk run typecheck && pnpm --filter @so/server run typecheck
```
Expected: `@so/sdk` 4 still pass; `@so/server` now 6 (4 + 2 transaction); typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(sdk,server): Db.transaction for atomic multi-statement writes"
```

---

## Task 2: `@so/actions` — package, migrations, transactional service

**Files:** Create `packages/actions/{package.json,tsconfig.json,vitest.config.ts,src/migrate.ts,src/service.ts}`

- [ ] **Step 1: `packages/actions/package.json`**

```json
{
  "name": "@so/actions",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "dependencies": {
    "@so/sdk": "workspace:*",
    "@so/auth": "workspace:*",
    "@so/ontology": "workspace:*",
    "fastify": "^5.2.0"
  },
  "devDependencies": {
    "@so/server": "workspace:*",
    "@so/observability": "workspace:*",
    "@so/datasets": "workspace:*",
    "@types/node": "^22.10.0",
    "@types/pg": "^8.11.0"
  }
}
```

- [ ] **Step 2: `pnpm install`**

- [ ] **Step 3: `packages/actions/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "types": ["node"] },
  "include": ["src/**/*", "test/**/*"]
}
```

- [ ] **Step 4: `packages/actions/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { testTimeout: 60_000, hookTimeout: 60_000 } });
```

- [ ] **Step 5: Create `packages/actions/src/migrate.ts`**

```ts
import type { Db } from '@so/sdk';

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS action_defs (
     id text PRIMARY KEY,
     org_id text NOT NULL,
     api_name text NOT NULL,
     object_type text NOT NULL,
     kind text NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     UNIQUE (org_id, api_name)
   )`,
  `CREATE TABLE IF NOT EXISTS audit_log (
     id text PRIMARY KEY,
     org_id text NOT NULL,
     actor text,
     action text NOT NULL,
     object_type text NOT NULL,
     primary_key text,
     params jsonb,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
];

export async function runMigrations(db: Db): Promise<void> {
  for (const sql of MIGRATIONS) await db.query(sql);
}
```

- [ ] **Step 6: Create `packages/actions/src/service.ts`**

```ts
import { randomUUID } from 'node:crypto';
import type { ModuleContext } from '@so/sdk';
import { createOntologyService } from '@so/ontology';

export type ActionKind = 'modify' | 'create';
export interface ActionDefInput { apiName: string; objectType: string; kind: ActionKind; }
export interface ExecuteInput { primaryKey: string; edits?: Record<string, unknown>; properties?: Record<string, unknown>; }

export function createActionService(ctx: ModuleContext) {
  const ontology = createOntologyService(ctx);

  async function createActionDef(orgId: string, input: ActionDefInput): Promise<void> {
    if (input.kind !== 'modify' && input.kind !== 'create') throw new Error('kind must be modify|create');
    const ot = await ontology.getObjectType(orgId, input.objectType);
    if (!ot) throw new Error(`object type not found: ${input.objectType}`);
    await ctx.db.query(
      `INSERT INTO action_defs(id,org_id,api_name,object_type,kind) VALUES ($1,$2,$3,$4,$5)`,
      [randomUUID(), orgId, input.apiName, input.objectType, input.kind],
    );
  }

  async function listActionDefs(orgId: string): Promise<ActionDefInput[]> {
    const rows = await ctx.db.query<{ api_name: string; object_type: string; kind: string }>(
      `SELECT api_name, object_type, kind FROM action_defs WHERE org_id = $1 ORDER BY api_name`,
      [orgId],
    );
    return rows.map((r) => ({ apiName: r.api_name, objectType: r.object_type, kind: r.kind as ActionKind }));
  }

  async function execute(orgId: string, actorId: string, apiName: string, input: ExecuteInput): Promise<void> {
    const defs = await ctx.db.query<{ object_type: string; kind: string }>(
      `SELECT object_type, kind FROM action_defs WHERE org_id = $1 AND api_name = $2`,
      [orgId, apiName],
    );
    const def = defs[0];
    if (!def) throw new Error(`action not found: ${apiName}`);
    if (!input.primaryKey) throw new Error('primaryKey required');

    const ot = await ontology.getObjectType(orgId, def.object_type);
    if (!ot) throw new Error(`object type not found: ${def.object_type}`);
    const propNames = new Set(ot.properties.map((p) => p.apiName));

    if (def.kind === 'modify') {
      const edits = input.edits ?? {};
      if (Object.keys(edits).length === 0) throw new Error('edits required for a modify action');
      for (const k of Object.keys(edits)) if (!propNames.has(k)) throw new Error(`unknown property: ${k}`);
      await ctx.db.transaction(async (tx) => {
        for (const [prop, value] of Object.entries(edits)) {
          const verRows = await tx.query<{ v: number }>(
            `SELECT COALESCE(MAX(version),0)+1 AS v FROM object_writeback
              WHERE org_id=$1 AND object_type=$2 AND primary_key=$3 AND property=$4`,
            [orgId, def.object_type, input.primaryKey, prop],
          );
          const version = Number(verRows[0]?.v ?? 1);
          await tx.query(
            `INSERT INTO object_writeback(org_id,object_type,primary_key,property,value,version,updated_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [orgId, def.object_type, input.primaryKey, prop, String(value), version, actorId],
          );
        }
        await tx.query(
          `INSERT INTO audit_log(id,org_id,actor,action,object_type,primary_key,params)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [randomUUID(), orgId, actorId, apiName, def.object_type, input.primaryKey, JSON.stringify(edits)],
        );
      });
    } else {
      const properties = input.properties ?? {};
      for (const k of Object.keys(properties)) if (!propNames.has(k)) throw new Error(`unknown property: ${k}`);
      await ctx.db.transaction(async (tx) => {
        await tx.query(
          `INSERT INTO object_created(org_id,object_type,primary_key,payload,created_by) VALUES ($1,$2,$3,$4,$5)`,
          [orgId, def.object_type, input.primaryKey, JSON.stringify(properties), actorId],
        );
        await tx.query(
          `INSERT INTO audit_log(id,org_id,actor,action,object_type,primary_key,params)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [randomUUID(), orgId, actorId, apiName, def.object_type, input.primaryKey, JSON.stringify(properties)],
        );
      });
    }
    ctx.events.emit('action.executed', { orgId, apiName, primaryKey: input.primaryKey });
  }

  return { createActionDef, listActionDefs, execute };
}
```

- [ ] **Step 7: Typecheck + commit**

```bash
pnpm --filter @so/actions run typecheck
git add -A && git commit -m "feat(actions): package + migrations + transactional action service"
```

---

## Task 3: Routes + module + integration test (the read+write proof)

**Files:** Create `packages/actions/src/routes.ts`, `packages/actions/src/index.ts`, `packages/actions/test/actions.int.test.ts`

- [ ] **Step 1: Create `packages/actions/src/routes.ts`**

```ts
import type { FastifyPluginAsync } from 'fastify';
import { requirePermission } from '@so/auth';
import { createActionService, type ActionDefInput, type ExecuteInput } from './service.js';

export const actionRoutes: FastifyPluginAsync = async (fastify) => {
  const svc = createActionService(fastify.ctx);

  fastify.post('/definitions', { preHandler: requirePermission('actions:edit') }, async (req, reply) => {
    const body = req.body as ActionDefInput;
    if (!body?.apiName || !body?.objectType || !body?.kind) {
      return reply.code(400).send({ error: 'apiName, objectType, kind required' });
    }
    try {
      await svc.createActionDef(req.user!.orgId, body);
      return reply.code(201).send({ ok: true });
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  fastify.get('/definitions', { preHandler: requirePermission('actions:read') }, async (req) => {
    return { actions: await svc.listActionDefs(req.user!.orgId) };
  });

  fastify.post('/:apiName/execute', { preHandler: requirePermission('actions:execute') }, async (req, reply) => {
    const { apiName } = req.params as { apiName: string };
    const body = (req.body ?? {}) as ExecuteInput;
    try {
      await svc.execute(req.user!.orgId, req.user!.id, apiName, body);
      return reply.code(200).send({ ok: true });
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });
};
```

- [ ] **Step 2: Create `packages/actions/src/index.ts`**

```ts
import { defineModule } from '@so/sdk';
import { runMigrations } from './migrate.js';
import { actionRoutes } from './routes.js';

export default defineModule({
  id: 'actions',
  dependsOn: ['ontology', 'auth'],
  contributes: {
    apiRoutes: actionRoutes,
    permissions: ['actions:read', 'actions:edit', 'actions:execute'],
  },
  async onInstall(ctx) {
    await runMigrations(ctx.db);
  },
});

export { createActionService, type ActionDefInput, type ExecuteInput } from './service.js';
```

- [ ] **Step 3: Create `packages/actions/test/actions.int.test.ts`**

```ts
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
```

- [ ] **Step 4: Run with infra up → PASS**

```bash
pnpm run infra:up
pnpm --filter @so/actions test
```
Expected: 2 tests pass — the first proves `setStatus` flips FL-204 from `Delayed` (base) to `Cancelled` (overlay) in resolved objects + writes audit; the second proves validation + auth. (Bash timeout 180000.) Then `pnpm --filter @so/actions run typecheck` (clean).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(actions): validated transactional actions + the write-back-overrides-base proof"
```

---

## Task 4: Full verification + merge

- [ ] **Step 1: Full suite**

```bash
pnpm run infra:up && pnpm run infra:seed
pnpm typecheck && pnpm lint && pnpm test
```
Expected: typecheck + lint clean; **45 tests** (prior 41 + server transaction 2 + actions 2).

- [ ] **Step 2: Merge**

```bash
git checkout main && git merge --ff-only phase7/module-actions
```

---

## Done criteria

- `Db.transaction` provides atomic multi-statement writes (commit/rollback), tested.
- `@so/actions` defines validated actions and executes them transactionally, writing the overlay + an audit row; `action.executed` is emitted.
- Executing a `modify` action flips a property in resolved objects (overlay overrides base) — the read+write loop is proven end-to-end through the product.
- Full suite green.

Plan 8 (`module-explorer` + `@so/ui-shell`) puts a React UI on top — object list, detail view with action buttons — making the whole slice (login → upload → model → act → browse) clickable and demoable.

---

## Self-review (against the spec)

- **Spec §6 (module-actions)** — action definitions, input validation (params must be real properties of the target type), ACID write-back store, per-action audit. ✓
- **Spec §7 (write-back overlay)** — `modify` appends a versioned `object_writeback` row (resolver reads max version → override); `create` inserts `object_created`; both inside a transaction. ✓
- **Spec §8 (NFRs)** — ACID via `Db.transaction`, optimistic versioning, audit log, parameterized SQL, auth-protected routes, integration-tested end-to-end. ✓
- **Placeholder scan** — complete code throughout. ✓
- **Type consistency** — `Db.transaction` added once and implemented in server + fake; `ActionDefInput`/`ExecuteInput`/`ActionKind` defined once; `createOntologyService.getObjectType` (Plan 6) used for validation; `req.user!.id`/`orgId` (Plan 5 augmentation); distinct `'Flight7'` object type + pre-cleanup keeps the test isolated in the parallel suite. ✓
- **Deliberately deferred:** rich parameter schemas / typed action params (Phase 2), action-level permissions beyond `actions:execute`, conflict detection on concurrent edits (versioning is append-only here), property-type coercion of overlay values (resolver casts; `int` already coerced). Flagged, not silent.
```
