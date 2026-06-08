# Phase 57 — Ontology Data Branching (Core) Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps `- [ ]`.

**Goal:** **Branch** the editable write-back overlay: create a named branch, make edits/creates on it (via Actions) in isolation from `main`, **preview**/resolve it, **diff** it, and **merge** it into `main`. The immutable Parquet base is shared; only the overlay is branched.

**Architecture:** A `branch text NOT NULL DEFAULT 'main'` column on `object_writeback`/`object_created`; resolution filters the overlay by branch (`buildResolveSql`); a `branch` flows via an `X-Branch` header (mirrors `X-Project`) into `actions.execute` and `resolveObjects`. Branch management lives in **`@so/ontology`** (it owns the overlay) — NO new module. Default `'main'` everywhere ⇒ fully backward-compatible.

**SECURITY:** `branch` is interpolated into SQL (correlated subqueries), so it MUST be validated to `^[A-Za-z0-9_-]+$` at every boundary AND guarded inside `buildResolveSql`.

---

## Pre-flight
- [ ] **Branch:** `git checkout main && git checkout -b phase57/branching-core`

---

## Task 1: `activeBranch` SDK helper

**Files:** Modify `packages/sdk/src/project.ts` (where `activeProjectId` lives) + the sdk barrel export (`packages/sdk/src/index.ts`)

- [ ] **Step 1** — add next to `activeProjectId`:
```ts
export function activeBranch(headers: Record<string, string | string[] | undefined>): string {
  const v = headers['x-branch'];
  const s = Array.isArray(v) ? v[0] : v;
  const b = s && s.trim() ? s.trim() : 'main';
  return /^[A-Za-z0-9_-]+$/.test(b) ? b : 'main';
}
```
- [ ] **Step 2** — ensure it's exported from the sdk barrel (same place `activeProjectId` is exported). `pnpm --filter @so/sdk typecheck` → 0.

---

## Task 2: Branch-aware resolution (`@so/query`) + unit test

**Files:** Modify `packages/query/src/types.ts`, `packages/query/src/sql.ts`; Create `packages/query/test/branch-sql.test.ts`

- [ ] **Step 1: `types.ts`** — add `branch?: string;` to `ResolveOptions`.
- [ ] **Step 2: `sql.ts`** — in `buildResolveSql`, near the top add:
```ts
  const branch = opts.branch ?? 'main';
  if (!/^[A-Za-z0-9_-]+$/.test(branch)) throw new Error(`invalid branch: ${branch}`);
```
  Then add the branch filter to BOTH overlay reads:
  - In the writeback correlated subquery (the `overlay` string), append before `ORDER BY`: `AND w.branch = '${branch}'`
  - In the `object_created` CTE `WHERE c.object_type = '${ot}'`, append: ` AND c.branch = '${branch}'`
- [ ] **Step 3: `branch-sql.test.ts`**
```ts
import { describe, it, expect } from 'vitest';
import { buildResolveSql } from '../src/sql.js';
import type { ObjectTypeMapping } from '../src/types.js';
const M: ObjectTypeMapping = {
  objectType: 'Flight', primaryKey: 'flightNumber',
  properties: [{ name: 'flightNumber', column: 'flight_no', type: 'string' }, { name: 'status', column: 'status', type: 'string' }],
  backing: { kind: 's3', path: 's3://b/f.parquet' },
};
describe('buildResolveSql branch filtering', () => {
  it("defaults to the 'main' branch", () => {
    const { sql } = buildResolveSql(M, 'pg', {});
    expect(sql).toContain("w.branch = 'main'");
    expect(sql).toContain("c.branch = 'main'");
  });
  it('scopes the overlay to a named branch', () => {
    const { sql } = buildResolveSql(M, 'pg', { branch: 'feature-x' });
    expect(sql).toContain("w.branch = 'feature-x'");
    expect(sql).toContain("c.branch = 'feature-x'");
  });
  it('rejects an unsafe branch name', () => {
    expect(() => buildResolveSql(M, 'pg', { branch: "x'; DROP TABLE--" })).toThrow(/invalid branch/);
  });
});
```
- [ ] **Step 4: Run → PASS:** `pnpm --filter @so/query test` (timeout 120000). Commit: `git add -A && git commit -m "feat(query): branch-scoped overlay resolution" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"`

---

## Task 3: Overlay branch columns + branches table + branch service (`@so/ontology`)

**Files:** Modify `packages/ontology/src/migrate.ts`, `packages/ontology/src/service.ts`, `packages/ontology/src/routes.ts`

- [ ] **Step 1: `migrate.ts`** — append to `MIGRATIONS`:
```ts
  `ALTER TABLE object_writeback ADD COLUMN IF NOT EXISTS branch text NOT NULL DEFAULT 'main'`,
  `ALTER TABLE object_created ADD COLUMN IF NOT EXISTS branch text NOT NULL DEFAULT 'main'`,
  `DO $$ BEGIN
     IF EXISTS (SELECT 1 FROM information_schema.key_column_usage WHERE table_name='object_created' AND constraint_name='object_created_pkey' AND column_name='primary_key')
        AND NOT EXISTS (SELECT 1 FROM information_schema.key_column_usage WHERE table_name='object_created' AND constraint_name='object_created_pkey' AND column_name='branch') THEN
       ALTER TABLE object_created DROP CONSTRAINT object_created_pkey;
       ALTER TABLE object_created ADD PRIMARY KEY (org_id, object_type, primary_key, branch);
     END IF;
   END $$`,
  `CREATE TABLE IF NOT EXISTS branches (
     id text PRIMARY KEY, org_id text NOT NULL, name text NOT NULL,
     status text NOT NULL DEFAULT 'open', created_by text,
     created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (org_id, name)
   )`,
```
(`object_writeback` PK already includes `version`, so a branch column needs no PK change there — versions stay globally monotonic per (org,type,pk,property).)

- [ ] **Step 2: `service.ts`** — READ it. Add a branch-name guard const `const BRANCH_RE = /^[A-Za-z0-9_-]+$/;`.
  - **`resolveObjects`**: widen the options type to include `branch?: string` and pass it through to `resolveObjectSet({ ..., options: options ?? {} })` (the option object already forwards `options`; just make sure `branch` is included — it is, since you pass the whole `options`). Confirm `ResolveOptions` now has `branch`.
  - **`resolveLinkedObjects`** (the function around lines 100–120 that calls `resolveObjects` twice): thread an optional `branch = 'main'` param and pass `{ ...existingOpts, branch }` into both internal `resolveObjects` calls (so linked-object resolution honors the active branch). Keep the default `'main'`.
  - Add branch-management functions:
```ts
  async function listBranches(orgId: string): Promise<Array<{ name: string; status: string; createdAt: string | null }>> {
    const rows = await ctx.db.query<{ name: string; status: string; created_at: string }>(`SELECT name, status, created_at FROM branches WHERE org_id = $1 ORDER BY created_at DESC`, [orgId]);
    return [{ name: 'main', status: 'main', createdAt: null }, ...rows.map((r) => ({ name: r.name, status: r.status, createdAt: r.created_at }))];
  }
  async function createBranch(orgId: string, name: string, createdBy: string): Promise<void> {
    if (!BRANCH_RE.test(name) || name === 'main') throw new Error('invalid branch name');
    await ctx.db.query(`INSERT INTO branches(id,org_id,name,created_by) VALUES ($1,$2,$3,$4) ON CONFLICT (org_id,name) DO NOTHING`, [randomUUID(), orgId, name, createdBy]);
  }
  async function diffBranch(orgId: string, name: string): Promise<{ edits: Array<{ objectType: string; primaryKey: string; property: string; value: string | null }>; creates: Array<{ objectType: string; primaryKey: string }> }> {
    if (!BRANCH_RE.test(name)) throw new Error('invalid branch name');
    const edits = await ctx.db.query<{ object_type: string; primary_key: string; property: string; value: string | null }>(
      `SELECT object_type, primary_key, property, value FROM object_writeback w WHERE org_id=$1 AND branch=$2
         AND version = (SELECT MAX(version) FROM object_writeback w2 WHERE w2.org_id=w.org_id AND w2.object_type=w.object_type AND w2.primary_key=w.primary_key AND w2.property=w.property AND w2.branch=$2)
       ORDER BY object_type, primary_key, property`, [orgId, name]);
    const creates = await ctx.db.query<{ object_type: string; primary_key: string }>(
      `SELECT object_type, primary_key FROM object_created WHERE org_id=$1 AND branch=$2 ORDER BY object_type, primary_key`, [orgId, name]);
    return {
      edits: edits.map((e) => ({ objectType: e.object_type, primaryKey: e.primary_key, property: e.property, value: e.value })),
      creates: creates.map((c) => ({ objectType: c.object_type, primaryKey: c.primary_key })),
    };
  }
  async function mergeBranch(orgId: string, name: string, actor: string): Promise<{ merged: number }> {
    if (!BRANCH_RE.test(name) || name === 'main') throw new Error('cannot merge this branch');
    let merged = 0;
    await ctx.db.transaction(async (tx) => {
      const edits = await tx.query<{ object_type: string; primary_key: string; property: string; value: string | null }>(
        `SELECT object_type, primary_key, property, value FROM object_writeback w WHERE org_id=$1 AND branch=$2
           AND version = (SELECT MAX(version) FROM object_writeback w2 WHERE w2.org_id=w.org_id AND w2.object_type=w.object_type AND w2.primary_key=w.primary_key AND w2.property=w.property AND w2.branch=$2)`, [orgId, name]);
      for (const e of edits) {
        const v = await tx.query<{ v: number }>(`SELECT COALESCE(MAX(version),0)+1 AS v FROM object_writeback WHERE org_id=$1 AND object_type=$2 AND primary_key=$3 AND property=$4`, [orgId, e.object_type, e.primary_key, e.property]);
        await tx.query(`INSERT INTO object_writeback(org_id,object_type,primary_key,property,value,version,branch,updated_by) VALUES ($1,$2,$3,$4,$5,$6,'main',$7)`, [orgId, e.object_type, e.primary_key, e.property, e.value, Number(v[0]?.v ?? 1), actor]);
        merged++;
      }
      const creates = await tx.query<{ object_type: string; primary_key: string; payload: unknown }>(`SELECT object_type, primary_key, payload FROM object_created WHERE org_id=$1 AND branch=$2`, [orgId, name]);
      for (const c of creates) {
        await tx.query(`INSERT INTO object_created(org_id,object_type,primary_key,payload,branch,created_by) VALUES ($1,$2,$3,$4,'main',$5) ON CONFLICT (org_id,object_type,primary_key,branch) DO UPDATE SET payload=EXCLUDED.payload`, [orgId, c.object_type, c.primary_key, JSON.stringify(c.payload), actor]);
        merged++;
      }
      await tx.query(`UPDATE branches SET status='merged' WHERE org_id=$1 AND name=$2`, [orgId, name]);
    });
    return { merged };
  }
  async function deleteBranch(orgId: string, name: string): Promise<void> {
    if (!BRANCH_RE.test(name) || name === 'main') throw new Error('cannot delete this branch');
    await ctx.db.transaction(async (tx) => {
      await tx.query(`DELETE FROM object_writeback WHERE org_id=$1 AND branch=$2`, [orgId, name]);
      await tx.query(`DELETE FROM object_created WHERE org_id=$1 AND branch=$2`, [orgId, name]);
      await tx.query(`DELETE FROM branches WHERE org_id=$1 AND name=$2`, [orgId, name]);
    });
  }
```
  (Ensure `randomUUID` is imported — it likely already is.) Add `listBranches, createBranch, diffBranch, mergeBranch, deleteBranch` to the service's returned object.

- [ ] **Step 3: `routes.ts`** — READ it. Add `import { activeBranch } from '@so/sdk';` (if not present). On the **GET objects** route (the one calling `svc.resolveObjects(... { limit, offset })`), add `branch: activeBranch(req.headers)` into the options object. If a **resolve-linked-objects** route exists, pass `activeBranch(req.headers)` as its branch arg. Then add branch routes:
```ts
  fastify.get('/branches', { preHandler: requirePermission('ontology:read') }, async (req) => ({ branches: await svc.listBranches(req.user!.orgId) }));
  fastify.post('/branches', { preHandler: requirePermission('ontology:edit') }, async (req, reply) => {
    const b = req.body as { name?: string };
    if (!b?.name) return reply.code(400).send({ error: 'name required' });
    try { await svc.createBranch(req.user!.orgId, b.name, req.user!.id); return reply.code(201).send({ ok: true }); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });
  fastify.get('/branches/:name/diff', { preHandler: requirePermission('ontology:read') }, async (req, reply) => {
    const { name } = req.params as { name: string };
    try { return reply.send(await svc.diffBranch(req.user!.orgId, name)); } catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });
  fastify.post('/branches/:name/merge', { preHandler: requirePermission('ontology:edit') }, async (req, reply) => {
    const { name } = req.params as { name: string };
    try { return reply.send(await svc.mergeBranch(req.user!.orgId, name, req.user!.id)); } catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });
  fastify.delete('/branches/:name', { preHandler: requirePermission('ontology:edit') }, async (req, reply) => {
    const { name } = req.params as { name: string };
    try { await svc.deleteBranch(req.user!.orgId, name); return reply.send({ ok: true }); } catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });
```
- [ ] **Step 4: typecheck** `pnpm --filter @so/ontology typecheck` → 0. Commit: `git add -A && git commit -m "feat(ontology): branch overlay + branch management (create/diff/merge/delete)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"`

---

## Task 4: Actions execute on a branch (`@so/actions`)

**Files:** Modify `packages/actions/src/service.ts`, `packages/actions/src/routes.ts`

- [ ] **Step 1: `service.ts`** — add a trailing `branch = 'main'` parameter to `execute(orgId, actorId, apiName, input, branch = 'main')`. Add `branch` to BOTH INSERTs:
  - writeback: `INSERT INTO object_writeback(org_id,object_type,primary_key,property,value,version,branch,updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)` with `branch` as `$7` and `actorId` as `$8`.
  - created: `INSERT INTO object_created(org_id,object_type,primary_key,payload,branch,created_by) VALUES ($1,$2,$3,$4,$5,$6)` with `branch` as `$5` and `actorId` as `$6`.
  (Leave the version-MAX query global — no branch filter — so versions stay unique across branches.)
- [ ] **Step 2: `routes.ts`** — `import { activeBranch } from '@so/sdk';` and pass `activeBranch(req.headers)` as the new last arg to `svc.execute(...)` on the execute route.
- [ ] **Step 3: typecheck** `pnpm --filter @so/actions typecheck` → 0.

---

## Task 5: Branch integration test (overlay mechanics)

**Files:** Modify `packages/ontology/test/*.int.test.ts` (READ it for the harness/login pattern; add a new `it`)

- [ ] **Step 1** — add a test that exercises branch create/diff/merge via the overlay tables directly (no DuckDB needed), then via the routes:
```ts
  it('branches: isolate edits, diff, and merge into main', async () => {
    const db = server.kernel.ctx.db;
    await db.query(`DELETE FROM object_writeback WHERE object_type='BR' `);
    await db.query(`DELETE FROM object_created WHERE object_type='BR'`);
    await db.query(`DELETE FROM branches WHERE name='feat1'`);
    // login as admin (reuse the file's existing login helper / cookie variable)
    // create a branch via the route
    expect((await server.app.inject({ method: 'POST', url: '/api/ontology/branches', headers: AUTH, payload: { name: 'feat1' } })).statusCode).toBe(201);
    // simulate an edit made on the branch (as actions.execute would)
    await db.query(`INSERT INTO object_writeback(org_id,object_type,primary_key,property,value,version,branch,updated_by) VALUES ('org_default','BR','k1','status','Delayed',1,'feat1','t')`);
    // diff shows the branch's edit
    const diff = (await server.app.inject({ method: 'GET', url: '/api/ontology/branches/feat1/diff', headers: AUTH })).json();
    expect(diff.edits.some((e: { primaryKey: string; value: string }) => e.primaryKey === 'k1' && e.value === 'Delayed')).toBe(true);
    // main has no such writeback row yet
    const mainBefore = await db.query(`SELECT 1 FROM object_writeback WHERE object_type='BR' AND primary_key='k1' AND branch='main'`);
    expect(mainBefore.length).toBe(0);
    // merge → main now carries the edit; branch marked merged
    const m = (await server.app.inject({ method: 'POST', url: '/api/ontology/branches/feat1/merge', headers: AUTH })).json();
    expect(m.merged).toBeGreaterThan(0);
    const mainAfter = await db.query(`SELECT value FROM object_writeback WHERE object_type='BR' AND primary_key='k1' AND branch='main'`);
    expect(mainAfter.length).toBe(1);
    const branches = (await server.app.inject({ method: 'GET', url: '/api/ontology/branches', headers: AUTH })).json().branches as Array<{ name: string; status: string }>;
    expect(branches.find((b) => b.name === 'feat1')?.status).toBe('merged');
    expect(branches.find((b) => b.name === 'main')).toBeTruthy();
  });
```
(Use the test file's REAL admin-cookie variable in place of `AUTH`, and its `server` reference. If the ontology test doesn't already start a server with auth+ontology, model it on the existing `it`s in that file.)

- [ ] **Step 2: Run → PASS:** `pnpm run infra:up && pnpm --filter @so/ontology test` (timeout 120000).
- [ ] **Step 3: Commit:** `git add -A && git commit -m "feat(actions): execute on a branch + ontology branch integration test" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"`

---

## Task 6: E2E proves branch isolation through real resolution

**Files:** Modify the e2e suite (READ it — it models `E2EFlight`, executes a modify action, and resolves objects)

- [ ] **Step 1** — after the existing action/resolve steps, add a branch flow using the e2e's real app/auth/object-type variables and a real primary key from its data:
```ts
    // create a branch and edit on it
    await app.inject({ method: 'POST', url: '/api/ontology/branches', headers: auth, payload: { name: 'wip' } });
    const branchAuth = { ...auth, 'x-branch': 'wip' };
    await app.inject({ method: 'POST', url: `/api/actions/${MODIFY_ACTION_APINAME}/execute`, headers: branchAuth, payload: { primaryKey: PK, edits: { status: 'BranchOnly' } } });
    // main is unchanged; branch sees the edit
    const onMain = await app.inject({ method: 'GET', url: `/api/ontology/object-types/${OT}/objects`, headers: auth });
    const onBranch = await app.inject({ method: 'GET', url: `/api/ontology/object-types/${OT}/objects`, headers: branchAuth });
    const findStatus = (resp: typeof onMain) => ((resp.json().objects as Array<Record<string, unknown>>).find((o) => String(o[PK_PROP]) === PK)?.status);
    expect(findStatus(onBranch)).toBe('BranchOnly');
    expect(findStatus(onMain)).not.toBe('BranchOnly');
    // merge → main now reflects it
    await app.inject({ method: 'POST', url: '/api/ontology/branches/wip/merge', headers: auth });
    const onMainAfter = await app.inject({ method: 'GET', url: `/api/ontology/object-types/${OT}/objects`, headers: auth });
    expect(findStatus(onMainAfter)).toBe('BranchOnly');
```
(Substitute the e2e's actual variable names: app instance, auth header, the modify action apiName, the object type apiName `OT`, the primary-key property name `PK_PROP`, and a concrete PK value present in the seeded data. The objects route returns rows keyed by property apiName.)

- [ ] **Step 2: Run → PASS:** `pnpm --filter @so/e2e test` (timeout 180000).

---

## Task 7: Full verification + merge (GATED)
- [ ] Run:
```bash
cd /Users/sumitagrawal/CODE/sumit/SoftwareOntology
pnpm run infra:up && pnpm run infra:seed
pnpm typecheck; tc=$?
pnpm lint; lint=$?
pnpm test >/tmp/p57.log 2>&1; t=$?
grep -E "Tests +[0-9]+ (passed|failed)" /tmp/p57.log | tail -1
echo "tc=$tc lint=$lint t=$t"
if [ $tc -eq 0 ] && [ $lint -eq 0 ] && [ $t -eq 0 ]; then git checkout main && git merge --ff-only phase57/branching-core && echo MERGED; else echo "NOT MERGING"; fi
```
**This touches the resolution core that EVERY object read depends on.** The `DEFAULT 'main'` columns + default `branch='main'` in resolution mean all existing suites (which never send `X-Branch`) must stay green — if ANY suite (esp. ontology/actions/aip/dashboards/e2e) goes red, investigate before merging; do NOT merge red. Flaky env: re-run once on mass ~60000ms timeouts / `ERR_IPC_CHANNEL_CLOSED` after confirming `docker info`.

---

## Self-review
- **Isolation** — overlay carries `branch`; `buildResolveSql` filters it; edits on a branch don't touch `main`. ✓
- **Preview/diff/merge** — resolve any branch via `X-Branch`; `diffBranch` lists a branch's edits/creates; `mergeBranch` re-applies them onto `main` with fresh versions. ✓
- **Backward-compatible** — `DEFAULT 'main'` backfill + `'main'` defaults; no `X-Branch` ⇒ identical behavior; admin-run suites/e2e unaffected unless they opt in. ✓
- **Safe** — `branch` validated `^[A-Za-z0-9_-]+$` at SDK helper, service, and inside `buildResolveSql`. ✓
- **Tested** — `buildResolveSql` branch unit tests; ontology branch create/diff/merge integration test; e2e branch isolation through real DuckDB resolution. ✓
- **Deferred → Plan 58 (UI):** branch switcher + Branches surface + run-actions-on-branch. **Pipeline/Parquet-output branching** (branching derived datasets, not just the edit overlay) is a larger future extension — flagged.
