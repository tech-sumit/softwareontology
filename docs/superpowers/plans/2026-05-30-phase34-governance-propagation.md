# Phase 34 (1B.2) — Governance: Marking Propagation + Ontology Enforcement Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps `- [ ]`.

**Goal:** (1) **Propagation** — a pipeline's derived dataset automatically inherits the **union of its input datasets' markings**, so sensitive data can't be "laundered" by transforming it. (2) **Close the bypass** — ontology object resolution enforces the same marking clearance on the backing dataset. Together: marked data stays protected through the data graph.

**Architecture:** A second generic slot, `datasetDerivationHooks` (sdk + kernel): `@so/pipelines` calls registered hooks after producing an output dataset (passing output + input dataset ids); `@so/governance` contributes a hook that calls its `propagateMarkings`. Ontology's resolve route consults the existing `datasetAccessPolicies` slot (from Plan 33) on the object type's backing dataset. No new module dependencies (both pipelines and ontology use generic slots).

---

## Pre-flight
- [ ] **Branch:** `git checkout main && git checkout -b phase34/governance-propagation`

---

## Task 1: `datasetDerivationHooks` slot + pipelines propagation + ontology enforcement

**Files:** Modify `packages/sdk/src/types.ts`, `packages/kernel/src/kernel.ts`, `packages/pipelines/src/service.ts`, `packages/ontology/src/routes.ts`

- [ ] **Step 1: SDK — modify `packages/sdk/src/types.ts`**

Extend `ContributionSlot` with `'datasetDerivationHooks'`:
```ts
export type ContributionSlot =
  | 'objectTypes' | 'linkTypes' | 'actions' | 'functions'
  | 'connectors' | 'jobs' | 'permissions' | 'schedules' | 'datasetAccessPolicies' | 'datasetDerivationHooks';
```
Add the type (after `DatasetAccessPolicy`):
```ts
export interface DatasetDerivationHook { onDerive(ctx: ModuleContext, outputDatasetId: string, inputDatasetIds: string[]): Promise<void>; }
```
Add to `Contributions` (after `datasetAccessPolicies?`):
```ts
  datasetDerivationHooks?: DatasetDerivationHook[];
```

- [ ] **Step 2: Kernel — modify `packages/kernel/src/kernel.ts`**

Add `'datasetDerivationHooks'` to `ARRAY_SLOTS`:
```ts
const ARRAY_SLOTS: ContributionSlot[] = [
  'objectTypes', 'linkTypes', 'actions', 'functions', 'connectors', 'jobs', 'permissions', 'schedules', 'datasetAccessPolicies', 'datasetDerivationHooks',
];
```

- [ ] **Step 3: Pipelines propagation — modify `packages/pipelines/src/service.ts`**

Add the import:
```ts
import type { ModuleContext, DatasetDerivationHook } from '@so/sdk';
```
(Replace the existing `import type { ModuleContext } from '@so/sdk';` — keep any other type imports on that line.)

**(a) Incremental branch** — change its input-dataset SELECT to also fetch `id`:
```ts
          const ds = await ctx.db.query<{ id: string; object_key: string }>(
            `SELECT id, object_key FROM datasets WHERE org_id = $1 AND name = $2 ORDER BY created_at DESC LIMIT 1`, [orgId, inputName],
          );
```
Then, immediately BEFORE the incremental branch's `await ctx.db.query(\`UPDATE pipeline_runs SET status='success'...` line, insert:
```ts
          const incHooks = ctx.registry.get<DatasetDerivationHook>('datasetDerivationHooks');
          for (const h of incHooks) await h.onDerive(ctx, outId, [ds[0].id]);
```

**(b) Non-incremental path** — before the `for (const inputName of pipe.inputs)` loop, add an accumulator:
```ts
        const inputDatasetIds: string[] = [];
```
Inside that loop, change the input-dataset SELECT to fetch `id` and push it:
```ts
          const ds = await ctx.db.query<{ id: string; object_key: string }>(
            `SELECT id, object_key FROM datasets WHERE org_id = $1 AND name = $2 ORDER BY created_at DESC LIMIT 1`,
            [orgId, inputName],
          );
          if (!ds[0]) throw new Error(`input dataset not found: ${inputName}`);
          inputDatasetIds.push(ds[0].id);
          const url = ctx.objectStore.getObjectUrl(ds[0].object_key);
```
Then, immediately BEFORE the non-incremental `await ctx.db.query(\`UPDATE pipeline_runs SET status='success', dataset_id=$1...` line (after the `dataset_columns` insert loop), insert:
```ts
        const hooks = ctx.registry.get<DatasetDerivationHook>('datasetDerivationHooks');
        for (const h of hooks) await h.onDerive(ctx, datasetId, inputDatasetIds);
```
(There are now two `id, object_key` SELECTs — one per branch — both correct.)

- [ ] **Step 4: Ontology resolution enforcement — modify `packages/ontology/src/routes.ts`**

Add to the imports:
```ts
import type { DatasetAccessPolicy } from '@so/sdk';
```
In the `GET /object-types/:apiName/objects` handler, after `if (!ot) return reply.code(404)...` and BEFORE `const perms = req.user!.permissions;`, insert:
```ts
      const policies = fastify.ctx.registry.get<DatasetAccessPolicy>('datasetAccessPolicies');
      for (const policy of policies) {
        if (!(await policy.check(fastify.ctx, req.user!.id, ot.datasetId))) {
          return reply.code(403).send({ error: 'access denied: insufficient clearance' });
        }
      }
```
(`ot.datasetId` is the backing dataset. Empty slot ⇒ no enforcement, so non-governance deployments are unchanged.)

---

## Task 2: Governance contributes the propagation hook

**Files:** Modify `packages/governance/src/index.ts`

- [ ] **Step 1: Add the derivation hook — modify `contributes` in `packages/governance/src/index.ts`**

Add to `contributes` (after `datasetAccessPolicies`):
```ts
    datasetDerivationHooks: [{ onDerive: (ctx, outputDatasetId, inputDatasetIds) => createGovernanceService(ctx).propagateMarkings(inputDatasetIds, outputDatasetId) }],
```

- [ ] **Step 2: Create `packages/governance/test/governance-propagation.int.test.ts`**
```ts
import { describe, it, expect, afterAll } from 'vitest';
import { createServer, createConfig, type AppServer } from '@so/server';
import { createLogger } from '@so/observability';
import authModule from '@so/auth';
import datasetsModule from '@so/datasets';
import pipelinesModule from '@so/pipelines';
import ontologyModule from '@so/ontology';
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
async function cleanMarking(db: { query: (s: string, p?: unknown[]) => Promise<unknown> }, name: string) {
  await db.query(`DELETE FROM role_markings WHERE marking_id IN (SELECT id FROM markings WHERE name=$1)`, [name]);
  await db.query(`DELETE FROM dataset_markings WHERE marking_id IN (SELECT id FROM markings WHERE name=$1)`, [name]);
  await db.query(`DELETE FROM markings WHERE name=$1`, [name]);
}

describe('governance: propagation + ontology enforcement', () => {
  it('propagates markings to a pipeline output (no laundering)', async () => {
    server = await createServer({ modules: [authModule, datasetsModule, pipelinesModule, ontologyModule, governanceModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();
    await cleanMarking(server.kernel.ctx.db, 'PII');
    await server.kernel.ctx.db.query(`DELETE FROM pipelines WHERE name='provpipe'`);

    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const a = { cookie: cookieFrom(login.headers['set-cookie']) };

    const ds = await server.app.inject({ method: 'POST', url: '/api/datasets?name=provin&format=csv', headers: { ...a, 'content-type': 'text/csv' }, payload: 'name,ssn\nAlice,111\nBob,222\n' });
    const inId = ds.json().dataset.id;
    const mk = await server.app.inject({ method: 'POST', url: '/api/governance/markings', headers: a, payload: { name: 'PII' } });
    const mid = mk.json().id;
    await server.app.inject({ method: 'POST', url: `/api/governance/markings/${mid}/datasets/${inId}`, headers: a });

    const pipe = await server.app.inject({ method: 'POST', url: '/api/pipelines', headers: a, payload: { name: 'provpipe', inputs: ['provin'], sql: 'SELECT * FROM provin' } });
    const run = await server.app.inject({ method: 'POST', url: `/api/pipelines/${pipe.json().id}/run`, headers: a });
    const outId = run.json().datasetId;

    // the OUTPUT inherited PII (propagation through the pipeline)
    const outMarks = await server.app.inject({ method: 'GET', url: `/api/governance/datasets/${outId}/markings`, headers: a });
    expect((outMarks.json().markings as Array<{ name: string }>).some((m) => m.name === 'PII')).toBe(true);

    // and the admin (uncleared) cannot read the derived output — no laundering
    expect((await server.app.inject({ method: 'GET', url: `/api/datasets/${outId}/preview`, headers: a })).statusCode).toBe(403);
    await server.app.inject({ method: 'POST', url: `/api/governance/markings/${mid}/roles/role_admin`, headers: a });
    expect((await server.app.inject({ method: 'GET', url: `/api/datasets/${outId}/preview`, headers: a })).statusCode).toBe(200);
  });

  it('enforces clearance on ontology object resolution', async () => {
    await cleanMarking(server.kernel.ctx.db, 'SECRET');
    await server.kernel.ctx.db.query(`DELETE FROM object_types WHERE api_name='SecObj'`);
    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const a = { cookie: cookieFrom(login.headers['set-cookie']) };

    const ds = await server.app.inject({ method: 'POST', url: '/api/datasets?name=secdata&format=csv', headers: { ...a, 'content-type': 'text/csv' }, payload: 'code,val\nA,x\nB,y\n' });
    const secDid = ds.json().dataset.id;
    const mk = await server.app.inject({ method: 'POST', url: '/api/governance/markings', headers: a, payload: { name: 'SECRET' } });
    const mid = mk.json().id;
    await server.app.inject({ method: 'POST', url: `/api/governance/markings/${mid}/datasets/${secDid}`, headers: a });
    await server.app.inject({ method: 'POST', url: '/api/ontology/object-types', headers: a, payload: { apiName: 'SecObj', datasetId: secDid, primaryKey: 'code', properties: [{ apiName: 'code', type: 'string' }, { apiName: 'val', type: 'string' }] } });

    // resolving objects on a SECRET-marked backing dataset is denied until cleared
    expect((await server.app.inject({ method: 'GET', url: '/api/ontology/object-types/SecObj/objects', headers: a })).statusCode).toBe(403);
    await server.app.inject({ method: 'POST', url: `/api/governance/markings/${mid}/roles/role_admin`, headers: a });
    expect((await server.app.inject({ method: 'GET', url: '/api/ontology/object-types/SecObj/objects', headers: a })).statusCode).toBe(200);
  });
});
```

- [ ] **Step 3: Run → PASS:** `pnpm run infra:up && pnpm --filter @so/governance test` AND `pnpm --filter @so/pipelines test` AND `pnpm --filter @so/ontology test` (timeout 180000) — the new propagation/enforcement tests pass; existing pipelines + ontology suites stay green (empty slots when governance absent). typecheck `@so/sdk`/`@so/kernel`/`@so/pipelines`/`@so/ontology`/`@so/governance` clean; no unused imports.

- [ ] **Step 4: Commit:** `git add -A && git commit -m "feat(governance): marking propagation through pipelines + ontology resolution enforcement"`

---

## Task 3: Full verification + merge
- [ ] `pnpm run infra:up && pnpm run infra:seed && pnpm typecheck; pnpm lint; pnpm test` (exit codes) → green (additive slots; e2e + all suites stay green — non-governance boots have empty hook/policy slots). `git checkout main && git merge --ff-only phase34/governance-propagation`.

---

## Self-review
- **1B propagation (the differentiator)** — derived datasets inherit the union of input markings; the test proves a plain `SELECT *` pipeline over PII data yields a PII-protected output the uncleared admin cannot read (no laundering). ✓
- **Bypass closed** — ontology object resolution enforces the same clearance on the backing dataset (second test: SECRET-marked → 403 until cleared). ✓
- **Decoupled** — propagation via a generic `datasetDerivationHooks` slot; ontology reuses the `datasetAccessPolicies` slot; neither pipelines nor ontology gains a governance dependency; empty slots ⇒ existing suites unaffected. ✓
- **Composes** — propagation fires for both full and incremental pipeline outputs. ✓
- **Deferred (continued 1B):** enforce input-clearance when *triggering* a pipeline; connector-ingest marking; column-level lineage; lineage view surfacing markings; purpose-based access; marking hierarchies/compartments; a governance UI. Flagged.
