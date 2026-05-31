# Phase 38 — Project-Scope Datasets Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps `- [ ]`.

**Goal:** Make datasets project-aware (the pattern other modules follow). The active project comes from an **`X-Project`** header (default `project_default`); **list** is project-scoped (the Data surface shows the active project's datasets), while **get-by-id stays org-scoped** so the shared ontology can resolve any backing dataset.

**Architecture:** A tiny `activeProjectId(headers)` helper in `@so/sdk` (no new deps). `datasets.project_id text NOT NULL DEFAULT 'project_default'` — so existing rows and direct inserts (pipeline/connector outputs) keep working. Only `ingest`/`list` change signature; both are called only by the datasets routes.

---

## Pre-flight
- [ ] **Branch:** `git checkout main && git checkout -b phase38/datasets-project-scope`

---

## Task 1: `activeProjectId` helper in `@so/sdk`

**Files:** Create `packages/sdk/src/project.ts`; Modify `packages/sdk/src/index.ts`

- [ ] **Step 1: Create `packages/sdk/src/project.ts`**
```ts
/** The active project for a request, from the `X-Project` header (defaults to 'project_default'). */
export function activeProjectId(headers: Record<string, string | string[] | undefined>): string {
  const v = headers['x-project'];
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.trim() ? s.trim() : 'project_default';
}
```

- [ ] **Step 2: Export it — modify `packages/sdk/src/index.ts`**

Add (next to the other exports): `export { activeProjectId } from './project.js';`

---

## Task 2: Project-scope `@so/datasets`

**Files:** Modify `packages/datasets/src/migrate.ts`, `packages/datasets/src/service.ts`, `packages/datasets/src/routes.ts`; Create `packages/datasets/test/dataset-projects.int.test.ts`

- [ ] **Step 1: Column — modify `packages/datasets/src/migrate.ts`**

Append to the `MIGRATIONS` array (datasets already uses `applyMigrations(db, 'datasets', MIGRATIONS)`):
```ts
  `ALTER TABLE datasets ADD COLUMN IF NOT EXISTS project_id text NOT NULL DEFAULT 'project_default'`,
```

- [ ] **Step 2: Service — modify `packages/datasets/src/service.ts`**

Change `ingest` to take `projectId` and store it. Update the signature and the INSERT:
```ts
  async function ingest(
    orgId: string,
    projectId: string,
    name: string,
    format: 'csv' | 'parquet',
    bytes: Buffer,
  ): Promise<DatasetMeta> {
```
…and the datasets INSERT (add the column + value):
```ts
      await ctx.db.query(
        `INSERT INTO datasets(id,org_id,project_id,name,object_key,row_count) VALUES ($1,$2,$3,$4,$5,$6)`,
        [id, orgId, projectId, name, objectKey, rowCount],
      );
```
Change `list` to filter by project:
```ts
  async function list(orgId: string, projectId: string): Promise<DatasetMeta[]> {
    const rows = await ctx.db.query<{ id: string; name: string; object_key: string; row_count: number }>(
      `SELECT id, name, object_key, row_count FROM datasets WHERE org_id = $1 AND project_id = $2 ORDER BY created_at DESC`,
      [orgId, projectId],
    );
    const out: DatasetMeta[] = [];
    for (const r of rows) out.push({ id: r.id, name: r.name, objectKey: r.object_key, rowCount: r.row_count, columns: await columnsFor(r.id) });
    return out;
  }
```
(Leave `get`, `preview`, `columnsFor` exactly as-is — `get` stays org-scoped by id so the shared ontology resolves any backing dataset.)

- [ ] **Step 3: Routes — modify `packages/datasets/src/routes.ts`**

Add to the imports:
```ts
import { activeProjectId } from '@so/sdk';
```
In `POST /`, pass the active project to ingest (it currently calls `svc.ingest(orgId, q.name, format, body)`):
```ts
    const orgId = req.user!.orgId;
    const dataset = await svc.ingest(orgId, activeProjectId(req.headers), q.name, format, body);
    return reply.code(201).send({ dataset });
```
In `GET /`, pass the active project to list:
```ts
  fastify.get('/', { preHandler: requirePermission('datasets:read') }, async (req) => {
    return { datasets: await svc.list(req.user!.orgId, activeProjectId(req.headers)) };
  });
```

- [ ] **Step 4: Create `packages/datasets/test/dataset-projects.int.test.ts`**
```ts
import { describe, it, expect, afterAll } from 'vitest';
import { createServer, createConfig, type AppServer } from '@so/server';
import { createLogger } from '@so/observability';
import authModule from '@so/auth';
import datasetsModule from '../src/index.js';

const config = createConfig({
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so',
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'localhost:9000', S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin', S3_BUCKET: process.env.S3_BUCKET ?? 'so-datasets',
  ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: 'admin',
});
let server: AppServer;
afterAll(async () => { await server?.stop(); });
function cookieFrom(s: string | string[] | undefined): string { const raw = Array.isArray(s) ? s[0]! : s!; return raw.split(';')[0]!; }

describe('datasets: project scoping', () => {
  it('list is scoped by X-Project; get-by-id stays org-wide', async () => {
    server = await createServer({ modules: [authModule, datasetsModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();
    await server.kernel.ctx.db.query(`DELETE FROM datasets WHERE name IN ('pdataA','pdataB')`);

    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const cookie = cookieFrom(login.headers['set-cookie']);
    const csv = { cookie, 'content-type': 'text/csv' };

    const upA = await server.app.inject({ method: 'POST', url: '/api/datasets?name=pdataA&format=csv', headers: { ...csv, 'x-project': 'projA' }, payload: 'k,v\n1,a\n' });
    const idA = upA.json().dataset.id;
    await server.app.inject({ method: 'POST', url: '/api/datasets?name=pdataB&format=csv', headers: { ...csv, 'x-project': 'projB' }, payload: 'k,v\n2,b\n' });

    const listA = await server.app.inject({ method: 'GET', url: '/api/datasets', headers: { cookie, 'x-project': 'projA' } });
    const namesA = (listA.json().datasets as Array<{ name: string }>).map((d) => d.name);
    expect(namesA).toContain('pdataA');
    expect(namesA).not.toContain('pdataB');

    const listB = await server.app.inject({ method: 'GET', url: '/api/datasets', headers: { cookie, 'x-project': 'projB' } });
    const namesB = (listB.json().datasets as Array<{ name: string }>).map((d) => d.name);
    expect(namesB).toContain('pdataB');
    expect(namesB).not.toContain('pdataA');

    // default project (no header) sees neither projA nor projB datasets
    const listDefault = await server.app.inject({ method: 'GET', url: '/api/datasets', headers: { cookie } });
    expect((listDefault.json().datasets as Array<{ name: string }>).map((d) => d.name)).not.toContain('pdataA');

    // get-by-id is org-scoped — resolvable regardless of the active project (no header)
    const getA = await server.app.inject({ method: 'GET', url: `/api/datasets/${idA}`, headers: { cookie } });
    expect(getA.statusCode).toBe(200);
    expect(getA.json().dataset.name).toBe('pdataA');
  });
});
```

- [ ] **Step 5: Run the FULL datasets suite (regression) → PASS:** `pnpm run infra:up && pnpm --filter @so/datasets test` (timeout 180000) — existing datasets tests (which send no `X-Project` ⇒ default project, and their uploads also default) PLUS the new scoping test pass. typecheck `@so/sdk` + `@so/datasets` clean; no unused imports.

- [ ] **Step 6: Commit:** `git add -A && git commit -m "feat(datasets): project scoping via X-Project header (list scoped, get-by-id org-wide)"`

---

## Task 3: Full verification + merge (GATED)
- [ ] `pnpm run infra:up && pnpm run infra:seed && pnpm typecheck; pnpm lint`; then `pnpm test >/tmp/v.log 2>&1; t=$?; grep -E "Tests +[0-9]+ (passed|failed)" /tmp/v.log | tail -1`. **Only if typecheck, lint, and `t` are all 0**: `git checkout main && git merge --ff-only phase38/datasets-project-scope`. The whole suite must stay green — existing tests don't send `X-Project`, so everything defaults to `project_default` (incl. pipeline/connector dataset outputs via the column default), and ontology resolution uses org-scoped `get`.

---

## Self-review
- **Project-scoped datasets** — `list` filters by the active project; `ingest` stamps it; the pattern other modules will copy. ✓
- **Shared ontology preserved** — `get(orgId, id)` stays org-scoped, so object types resolve their backing dataset across projects. ✓
- **Backward-compat** — `project_id` defaults to `project_default`; no-header requests + direct inserts behave as today; full suite stays green. ✓
- **No blast radius** — only `ingest`/`list` signatures change, both called only by the datasets routes; `activeProjectId` is a pure `@so/sdk` helper. ✓
- **Deferred:** project-scoped `preview`/`get` hard-isolation (kept org-wide for shared ontology; per-project ACLs are a later effort); scoping pipeline input-resolution by project (Plan 39). Flagged.
