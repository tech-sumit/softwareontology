# Phase 33 (1B.1) — Governance: Markings & Mandatory Access Control Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps `- [ ]`.

**Goal:** Foundry-style **markings** (classifications like `PII`/`SECRET`) applied to datasets, with **mandatory access control**: to read a dataset you must hold clearance for *every* marking on it — enforced even for admins (markings are not bypassed by `*`). Clearances are granted to roles; a user's clearances = the union over their roles.

**Architecture:** New `@so/governance` module (markings, `dataset_markings`, `role_markings` + service + API) depending only on `auth`. Enforcement is decoupled via a **generic `datasetAccessPolicies` extension slot** (sdk + kernel) — `@so/datasets`'s preview route consults registered policies (empty slot ⇒ open, so existing tests are unaffected); `@so/governance` contributes a marking-clearance policy. This avoids any dependency inversion or blast radius on the foundational `datasets` module.

---

## Pre-flight
- [ ] **Branch:** `git checkout main && git checkout -b phase33/governance-markings`

---

## Task 1: The `datasetAccessPolicies` slot (sdk + kernel) + datasets enforcement

**Files:** Modify `packages/sdk/src/types.ts`, `packages/kernel/src/kernel.ts`, `packages/datasets/src/routes.ts`

- [ ] **Step 1: SDK — modify `packages/sdk/src/types.ts`**

Extend the `ContributionSlot` union with `'datasetAccessPolicies'`:
```ts
export type ContributionSlot =
  | 'objectTypes' | 'linkTypes' | 'actions' | 'functions'
  | 'connectors' | 'jobs' | 'permissions' | 'schedules' | 'datasetAccessPolicies';
```
Add the type (after `ScheduleDefinition`):
```ts
export interface DatasetAccessPolicy { check(ctx: ModuleContext, userId: string, datasetId: string): Promise<boolean>; }
```
Add to `Contributions` (after `schedules?`):
```ts
  datasetAccessPolicies?: DatasetAccessPolicy[];
```

- [ ] **Step 2: Kernel — modify `packages/kernel/src/kernel.ts`**

Add `'datasetAccessPolicies'` to `ARRAY_SLOTS`:
```ts
const ARRAY_SLOTS: ContributionSlot[] = [
  'objectTypes', 'linkTypes', 'actions', 'functions', 'connectors', 'jobs', 'permissions', 'schedules', 'datasetAccessPolicies',
];
```

- [ ] **Step 3: Enforce in datasets preview — modify `packages/datasets/src/routes.ts`**

Add to the imports:
```ts
import type { DatasetAccessPolicy } from '@so/sdk';
```
In the `GET /:id/preview` handler, after the `if (!ds) return reply.code(404)...` line and before the `const rows = ...`:
```ts
    const policies = fastify.ctx.registry.get<DatasetAccessPolicy>('datasetAccessPolicies');
    for (const policy of policies) {
      if (!(await policy.check(fastify.ctx, req.user!.id, id))) {
        return reply.code(403).send({ error: 'access denied: insufficient clearance' });
      }
    }
```
(Empty slot ⇒ loop body never runs ⇒ unchanged behavior. `req.user!.id` is the user id.)

---

## Task 2: `@so/governance` module

**Files:** Create `packages/governance/{package.json,tsconfig.json,vitest.config.ts,src/migrate.ts,src/service.ts,src/routes.ts,src/index.ts,test/governance.int.test.ts}`

- [ ] **Step 1: `packages/governance/package.json`**
```json
{
  "name": "@so/governance", "version": "0.0.0", "private": true, "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "dependencies": { "@so/sdk": "workspace:*", "@so/auth": "workspace:*", "fastify": "^5.2.0" },
  "devDependencies": { "@so/server": "workspace:*", "@so/observability": "workspace:*", "@so/datasets": "workspace:*", "@types/node": "^22.10.0" }
}
```

- [ ] **Step 2: `pnpm install`**

- [ ] **Step 3: `packages/governance/tsconfig.json`**
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "outDir": "dist", "types": ["node"] }, "include": ["src/**/*", "test/**/*"] }
```

- [ ] **Step 4: `packages/governance/vitest.config.ts`**
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { testTimeout: 60_000, hookTimeout: 60_000 } });
```

- [ ] **Step 5: `packages/governance/src/migrate.ts`**
```ts
import { applyMigrations, type Db } from '@so/sdk';

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS markings (
    id text PRIMARY KEY, org_id text NOT NULL, name text NOT NULL, UNIQUE (org_id, name)
  )`,
  `CREATE TABLE IF NOT EXISTS dataset_markings (
    dataset_id text NOT NULL, marking_id text NOT NULL, PRIMARY KEY (dataset_id, marking_id)
  )`,
  `CREATE TABLE IF NOT EXISTS role_markings (
    role_id text NOT NULL, marking_id text NOT NULL, PRIMARY KEY (role_id, marking_id)
  )`,
];

export async function runMigrations(db: Db): Promise<void> {
  await applyMigrations(db, 'governance', MIGRATIONS);
}
```

- [ ] **Step 6: `packages/governance/src/service.ts`**
```ts
import { randomUUID } from 'node:crypto';
import type { ModuleContext } from '@so/sdk';

const NAME_RE = /^[A-Za-z0-9 _:-]+$/;

export interface Marking { id: string; name: string; }

export function createGovernanceService(ctx: ModuleContext) {
  async function createMarking(orgId: string, name: string): Promise<string> {
    if (!name || !NAME_RE.test(name)) throw new Error('invalid marking name');
    const existing = await ctx.db.query<{ id: string }>(`SELECT id FROM markings WHERE org_id = $1 AND name = $2`, [orgId, name]);
    if (existing[0]) return existing[0].id;
    const id = randomUUID();
    await ctx.db.query(`INSERT INTO markings(id,org_id,name) VALUES ($1,$2,$3)`, [id, orgId, name]);
    return id;
  }

  async function listMarkings(orgId: string): Promise<Marking[]> {
    return ctx.db.query<Marking>(`SELECT id, name FROM markings WHERE org_id = $1 ORDER BY name`, [orgId]);
  }

  async function requireMarking(orgId: string, markingId: string): Promise<void> {
    const m = await ctx.db.query<{ id: string }>(`SELECT id FROM markings WHERE org_id = $1 AND id = $2`, [orgId, markingId]);
    if (!m[0]) throw new Error('marking not found');
  }

  async function applyToDataset(orgId: string, datasetId: string, markingId: string): Promise<void> {
    await requireMarking(orgId, markingId);
    await ctx.db.query(`INSERT INTO dataset_markings(dataset_id,marking_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [datasetId, markingId]);
  }

  async function grantToRole(orgId: string, roleId: string, markingId: string): Promise<void> {
    await requireMarking(orgId, markingId);
    await ctx.db.query(`INSERT INTO role_markings(role_id,marking_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [roleId, markingId]);
  }

  async function datasetMarkings(datasetId: string): Promise<Marking[]> {
    return ctx.db.query<Marking>(
      `SELECT m.id, m.name FROM dataset_markings dm JOIN markings m ON m.id = dm.marking_id WHERE dm.dataset_id = $1 ORDER BY m.name`, [datasetId],
    );
  }

  async function userClearances(userId: string): Promise<Marking[]> {
    return ctx.db.query<Marking>(
      `SELECT DISTINCT m.id, m.name FROM role_markings rm
         JOIN markings m ON m.id = rm.marking_id
        WHERE rm.role_id IN (SELECT role_id FROM user_roles WHERE user_id = $1) ORDER BY m.name`, [userId],
    );
  }

  async function canReadDataset(userId: string, datasetId: string): Promise<boolean> {
    const required = await ctx.db.query<{ marking_id: string }>(`SELECT marking_id FROM dataset_markings WHERE dataset_id = $1`, [datasetId]);
    if (required.length === 0) return true;
    const cleared = new Set((await ctx.db.query<{ marking_id: string }>(
      `SELECT DISTINCT marking_id FROM role_markings WHERE role_id IN (SELECT role_id FROM user_roles WHERE user_id = $1)`, [userId],
    )).map((r) => r.marking_id));
    return required.every((r) => cleared.has(r.marking_id));
  }

  /** Output dataset inherits the union of input datasets' markings (used by pipeline propagation, Plan 34). */
  async function propagateMarkings(inputDatasetIds: string[], outputDatasetId: string): Promise<void> {
    if (inputDatasetIds.length === 0) return;
    const rows = await ctx.db.query<{ marking_id: string }>(
      `SELECT DISTINCT marking_id FROM dataset_markings WHERE dataset_id = ANY($1)`, [inputDatasetIds],
    );
    for (const r of rows) {
      await ctx.db.query(`INSERT INTO dataset_markings(dataset_id,marking_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [outputDatasetId, r.marking_id]);
    }
  }

  return { createMarking, listMarkings, applyToDataset, grantToRole, datasetMarkings, userClearances, canReadDataset, propagateMarkings };
}
```

- [ ] **Step 7: `packages/governance/src/routes.ts`**
```ts
import type { FastifyPluginAsync } from 'fastify';
import { requirePermission } from '@so/auth';
import { createGovernanceService } from './service.js';

export const governanceRoutes: FastifyPluginAsync = async (fastify) => {
  const svc = createGovernanceService(fastify.ctx);

  fastify.post('/markings', { preHandler: requirePermission('governance:manage') }, async (req, reply) => {
    const b = req.body as { name?: string };
    if (!b?.name) return reply.code(400).send({ error: 'name required' });
    try { return reply.code(201).send({ id: await svc.createMarking(req.user!.orgId, b.name) }); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  fastify.get('/markings', { preHandler: requirePermission('governance:read') }, async (req) => ({ markings: await svc.listMarkings(req.user!.orgId) }));

  fastify.post('/markings/:id/datasets/:datasetId', { preHandler: requirePermission('governance:manage') }, async (req, reply) => {
    const { id, datasetId } = req.params as { id: string; datasetId: string };
    try { await svc.applyToDataset(req.user!.orgId, datasetId, id); return reply.send({ ok: true }); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  fastify.post('/markings/:id/roles/:roleId', { preHandler: requirePermission('governance:manage') }, async (req, reply) => {
    const { id, roleId } = req.params as { id: string; roleId: string };
    try { await svc.grantToRole(req.user!.orgId, roleId, id); return reply.send({ ok: true }); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  fastify.get('/datasets/:datasetId/markings', { preHandler: requirePermission('governance:read') }, async (req) => {
    const { datasetId } = req.params as { datasetId: string };
    return { markings: await svc.datasetMarkings(datasetId) };
  });

  fastify.get('/me/clearances', { preHandler: requirePermission('governance:read') }, async (req) => ({ clearances: await svc.userClearances(req.user!.id) }));
};
```

- [ ] **Step 8: `packages/governance/src/index.ts`**
```ts
import { defineModule } from '@so/sdk';
import { runMigrations } from './migrate.js';
import { governanceRoutes } from './routes.js';
import { createGovernanceService } from './service.js';

export default defineModule({
  id: 'governance',
  dependsOn: ['auth'],
  contributes: {
    apiRoutes: governanceRoutes,
    permissions: ['governance:read', 'governance:manage'],
    datasetAccessPolicies: [{ check: (ctx, userId, datasetId) => createGovernanceService(ctx).canReadDataset(userId, datasetId) }],
  },
  async onInstall(ctx) { await runMigrations(ctx.db); },
});

export { createGovernanceService, type Marking } from './service.js';
```

- [ ] **Step 9: `packages/governance/test/governance.int.test.ts`**
```ts
import { describe, it, expect, afterAll } from 'vitest';
import { createServer, createConfig, type AppServer } from '@so/server';
import { createLogger } from '@so/observability';
import authModule from '@so/auth';
import datasetsModule from '@so/datasets';
import governanceModule from '../src/index.js';

const config = createConfig({
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so',
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'localhost:9000', S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin', S3_BUCKET: process.env.S3_BUCKET ?? 'so-datasets',
  ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: 'admin',
});
let server: AppServer;
afterAll(async () => { await server?.stop(); });
function cookieFrom(s: string | string[] | undefined): string { const raw = Array.isArray(s) ? s[0]! : s!; return raw.split(';')[0]!; }

describe('governance: marking-based mandatory access control', () => {
  it('denies a marked dataset until the user is cleared — even the admin', async () => {
    server = await createServer({ modules: [authModule, datasetsModule, governanceModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();
    const db = server.kernel.ctx.db;
    // deterministic start: drop any prior 'PII' marking + its grants/applies
    await db.query(`DELETE FROM role_markings WHERE marking_id IN (SELECT id FROM markings WHERE name='PII')`);
    await db.query(`DELETE FROM dataset_markings WHERE marking_id IN (SELECT id FROM markings WHERE name='PII')`);
    await db.query(`DELETE FROM markings WHERE name='PII'`);

    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const a = { cookie: cookieFrom(login.headers['set-cookie']) };

    const ds = await server.app.inject({ method: 'POST', url: '/api/datasets?name=govdata&format=csv', headers: { ...a, 'content-type': 'text/csv' }, payload: 'name,ssn\nAlice,111\nBob,222\n' });
    const did = ds.json().dataset.id;

    // unmarked -> readable
    expect((await server.app.inject({ method: 'GET', url: `/api/datasets/${did}/preview`, headers: a })).statusCode).toBe(200);

    const mk = await server.app.inject({ method: 'POST', url: '/api/governance/markings', headers: a, payload: { name: 'PII' } });
    const mid = mk.json().id;
    await server.app.inject({ method: 'POST', url: `/api/governance/markings/${mid}/datasets/${did}`, headers: a });

    // marked, admin not cleared -> 403 (mandatory access; '*' does NOT bypass)
    expect((await server.app.inject({ method: 'GET', url: `/api/datasets/${did}/preview`, headers: a })).statusCode).toBe(403);

    // grant PII to the admin role -> now cleared
    await server.app.inject({ method: 'POST', url: `/api/governance/markings/${mid}/roles/role_admin`, headers: a });
    expect((await server.app.inject({ method: 'GET', url: `/api/datasets/${did}/preview`, headers: a })).statusCode).toBe(200);

    const clr = await server.app.inject({ method: 'GET', url: '/api/governance/me/clearances', headers: a });
    expect((clr.json().clearances as Array<{ name: string }>).some((m) => m.name === 'PII')).toBe(true);
  });
});
```

- [ ] **Step 10: Run → PASS:** `pnpm run infra:up && pnpm --filter @so/governance test` AND `pnpm --filter @so/datasets test` (timeout 180000) — governance test green; datasets tests still green (empty policy slot when governance absent). typecheck `@so/sdk`/`@so/kernel`/`@so/datasets`/`@so/governance` clean; no unused imports.

- [ ] **Step 11: Commit:** `git add -A && git commit -m "feat(governance): markings + mandatory access control (datasetAccessPolicies slot)"`

---

## Task 3: Full verification + merge
- [ ] `pnpm run infra:up && pnpm run infra:seed && pnpm typecheck; pnpm lint; pnpm test` (exit codes) → green (sdk/kernel/datasets changes are additive; the e2e + all datasets-dependent suites must stay green — they don't load governance, so the policy slot is empty ⇒ open). `git checkout main && git merge --ff-only phase33/governance-markings`.

---

## Self-review
- **1B (governance), core** — datasets carry markings; reading requires clearance for every marking (mandatory access), granted via roles, **not bypassed by `*`** (the test proves even admin is denied until cleared). ✓
- **Decoupled / zero blast radius** — enforcement via a generic `datasetAccessPolicies` slot; `datasets` gains no governance dependency; empty slot ⇒ existing behavior, so all other suites stay green. ✓
- **Layered with RBAC** — preview still needs `datasets:read` (RBAC) **and** clearance (MAC). ✓
- **Foundation for Plan 34** — `propagateMarkings` is defined here; Plan 34 wires it into pipelines (derived datasets inherit source markings) + enforces on ontology resolution + shows markings in lineage. ✓
- **Deferred (continued 1B):** propagation through pipelines (Plan 34), ontology-resolution enforcement (Plan 34), column-level lineage, purpose-based access, a governance UI, marking hierarchies/compartments, connector-ingest marking. Flagged.
