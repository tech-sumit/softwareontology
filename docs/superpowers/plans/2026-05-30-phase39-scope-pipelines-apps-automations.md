# Phase 39 — Project-Scope Pipelines, Apps, Automations Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps `- [ ]`.

**Goal:** Apply the Plan-38 project-scoping pattern to **pipelines**, **apps**, and **automations**: a `project_id` column (default `project_default`), `create` stamps the active project, `list` filters by it (via the `X-Project` header / `activeProjectId`). Get/update/delete/run by id stay org-scoped.

**Architecture:** Identical mechanical pattern per module (mirrors `@so/datasets` in Plan 38). `activeProjectId(req.headers)` is already in `@so/sdk`. Backward-compatible: the column default + no-header ⇒ `project_default`, so the suite stays green. **Deferred:** scoping pipeline `run()`'s input resolution + output-dataset project (outputs land in `project_default` for now) — a later refinement.

---

## Pre-flight
- [ ] **Branch:** `git checkout main && git checkout -b phase39/scope-pipelines-apps-automations`

---

## Task 1: Project-scope `@so/pipelines` (create + list)

**Files:** Modify `packages/pipelines/src/migrate.ts`, `packages/pipelines/src/service.ts`, `packages/pipelines/src/routes.ts`; Create `packages/pipelines/test/pipeline-projects.int.test.ts`

- [ ] **Step 1: Column — `migrate.ts`** — append to the `MIGRATIONS` array:
```ts
  `ALTER TABLE pipelines ADD COLUMN IF NOT EXISTS project_id text NOT NULL DEFAULT 'project_default'`,
```

- [ ] **Step 2: Service — `service.ts`** — change `createPipeline` + `listPipelines` only:
  - `createPipeline(orgId: string, projectId: string, input: PipelineInput)`: change the `INSERT INTO pipelines(...)` to include `project_id` (add the column + a `$N` for `projectId`). It currently inserts 9 columns `(id,org_id,name,sql,inputs,steps,expectations,incremental,watermark_column)` → add `,project_id` and the value `projectId`.
  - `listPipelines(orgId: string, projectId: string)`: add `AND project_id = $2` to the SELECT (and pass `[orgId, projectId]`).
  - Leave `run`, `listRuns`, `getRun` EXACTLY as-is.

- [ ] **Step 3: Routes — `routes.ts`** — import `activeProjectId` from `@so/sdk`; in the create route pass `activeProjectId(req.headers)` to `createPipeline` (after `req.user!.orgId`); in the list route pass it to `listPipelines`. Leave `/:id/run`, `/:id/runs`, `/runs/:runId`, `/:id/schedule` unchanged.

- [ ] **Step 4: Test — `packages/pipelines/test/pipeline-projects.int.test.ts`**
```ts
import { describe, it, expect, afterAll } from 'vitest';
import { createServer, createConfig, type AppServer } from '@so/server';
import { createLogger } from '@so/observability';
import authModule from '@so/auth';
import datasetsModule from '@so/datasets';
import pipelinesModule from '../src/index.js';

const config = createConfig({
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so',
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'localhost:9000', S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin', S3_BUCKET: process.env.S3_BUCKET ?? 'so-datasets',
  ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: 'admin',
});
let server: AppServer;
afterAll(async () => { await server?.stop(); });
function cookieFrom(s: string | string[] | undefined): string { const raw = Array.isArray(s) ? s[0]! : s!; return raw.split(';')[0]!; }

describe('pipelines: project scoping', () => {
  it('list is scoped by X-Project', async () => {
    server = await createServer({ modules: [authModule, datasetsModule, pipelinesModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();
    await server.kernel.ctx.db.query(`DELETE FROM pipelines WHERE name IN ('ppipeA','ppipeB')`);
    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const cookie = cookieFrom(login.headers['set-cookie']);

    await server.app.inject({ method: 'POST', url: '/api/pipelines', headers: { cookie, 'x-project': 'projA' }, payload: { name: 'ppipeA', inputs: ['srcA'], sql: 'SELECT 1 AS n' } });
    await server.app.inject({ method: 'POST', url: '/api/pipelines', headers: { cookie, 'x-project': 'projB' }, payload: { name: 'ppipeB', inputs: ['srcB'], sql: 'SELECT 1 AS n' } });

    const listA = (await server.app.inject({ method: 'GET', url: '/api/pipelines', headers: { cookie, 'x-project': 'projA' } })).json().pipelines as Array<{ name: string }>;
    expect(listA.map((p) => p.name)).toContain('ppipeA');
    expect(listA.map((p) => p.name)).not.toContain('ppipeB');
  });
});
```

- [ ] **Step 5: Run → PASS:** `pnpm run infra:up && pnpm --filter @so/pipelines test` (timeout 180000). Full pipelines suite (existing + new) green; typecheck clean.

- [ ] **Step 6: Commit:** `git add -A && git commit -m "feat(pipelines): project-scope create+list (X-Project)"`

---

## Task 2: Project-scope `@so/apps` (create + list)

**Files:** Modify `packages/apps/src/migrate.ts`, `packages/apps/src/service.ts`, `packages/apps/src/routes.ts`; Create `packages/apps/test/app-projects.int.test.ts`

- [ ] **Step 1: Column — `migrate.ts`** — append to `MIGRATIONS`:
```ts
  `ALTER TABLE apps ADD COLUMN IF NOT EXISTS project_id text NOT NULL DEFAULT 'project_default'`,
```

- [ ] **Step 2: Service — `service.ts`**:
  - `createApp(orgId: string, projectId: string, name: string, definition: unknown)`: change the INSERT to `INSERT INTO apps(id,org_id,project_id,name,definition) VALUES ($1,$2,$3,$4,$5)` with `[id, orgId, projectId, name, JSON.stringify(def)]`.
  - `listApps(orgId: string, projectId: string)`: `SELECT id, name FROM apps WHERE org_id = $1 AND project_id = $2 ORDER BY name` with `[orgId, projectId]`.
  - Leave `getApp`, `updateApp`, `deleteApp` (by id) EXACTLY as-is.

- [ ] **Step 3: Routes — `routes.ts`**: import `activeProjectId` from `@so/sdk`; create route → `svc.createApp(req.user!.orgId, activeProjectId(req.headers), b.name, b.definition ?? { widgets: [] })`; list route → `svc.listApps(req.user!.orgId, activeProjectId(req.headers))`.

- [ ] **Step 4: Test — `packages/apps/test/app-projects.int.test.ts`** (same shape as Task 1's test, modules `[authModule, appsModule]`, cleanup `DELETE FROM apps WHERE name IN ('appA','appB')`):
```ts
import { describe, it, expect, afterAll } from 'vitest';
import { createServer, createConfig, type AppServer } from '@so/server';
import { createLogger } from '@so/observability';
import authModule from '@so/auth';
import appsModule from '../src/index.js';

const config = createConfig({
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so',
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'localhost:9000', S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin', S3_BUCKET: process.env.S3_BUCKET ?? 'so-datasets',
  ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: 'admin',
});
let server: AppServer;
afterAll(async () => { await server?.stop(); });
function cookieFrom(s: string | string[] | undefined): string { const raw = Array.isArray(s) ? s[0]! : s!; return raw.split(';')[0]!; }

describe('apps: project scoping', () => {
  it('list is scoped by X-Project', async () => {
    server = await createServer({ modules: [authModule, appsModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();
    await server.kernel.ctx.db.query(`DELETE FROM apps WHERE name IN ('appA','appB')`);
    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const cookie = cookieFrom(login.headers['set-cookie']);

    await server.app.inject({ method: 'POST', url: '/api/apps', headers: { cookie, 'x-project': 'projA' }, payload: { name: 'appA', definition: { widgets: [] } } });
    await server.app.inject({ method: 'POST', url: '/api/apps', headers: { cookie, 'x-project': 'projB' }, payload: { name: 'appB', definition: { widgets: [] } } });

    const listA = (await server.app.inject({ method: 'GET', url: '/api/apps', headers: { cookie, 'x-project': 'projA' } })).json().apps as Array<{ name: string }>;
    expect(listA.map((a) => a.name)).toContain('appA');
    expect(listA.map((a) => a.name)).not.toContain('appB');
  });
});
```

- [ ] **Step 5: Run → PASS:** `pnpm --filter @so/apps test` (timeout 180000). typecheck clean.

- [ ] **Step 6: Commit:** `git add -A && git commit -m "feat(apps): project-scope create+list (X-Project)"`

---

## Task 3: Project-scope `@so/automations` (create + list)

**Files:** Modify `packages/automations/src/migrate.ts`, `packages/automations/src/service.ts`, `packages/automations/src/routes.ts`; Create `packages/automations/test/automation-projects.int.test.ts`

- [ ] **Step 1: Column — `migrate.ts`** — append to `MIGRATIONS`:
```ts
  `ALTER TABLE automations ADD COLUMN IF NOT EXISTS project_id text NOT NULL DEFAULT 'project_default'`,
```

- [ ] **Step 2: Service — `service.ts`**:
  - `createAutomation(orgId: string, projectId: string, input: AutomationInput)`: change the INSERT to include `project_id` (add the column + `$N` value `projectId`).
  - `listAutomations(orgId: string, projectId: string)`: add `AND project_id = $2` (pass `[orgId, projectId]`).
  - Leave the event-bus trigger query in `index.ts` (org-scoped) UNCHANGED.

- [ ] **Step 3: Routes — `routes.ts`**: import `activeProjectId` from `@so/sdk`; create route → pass `activeProjectId(req.headers)` as the 2nd arg to `createAutomation`; list route → pass it to `listAutomations`.

- [ ] **Step 4: Test — `packages/automations/test/automation-projects.int.test.ts`** (same shape; modules `[authModule, automationsModule]`; cleanup `DELETE FROM automations WHERE name IN ('autoA','autoB')`; create payloads `{ name, triggerAction: 'tA', thenAction: 'tB', thenEdits: {} }`; assert list scoped by `x-project`).
```ts
import { describe, it, expect, afterAll } from 'vitest';
import { createServer, createConfig, type AppServer } from '@so/server';
import { createLogger } from '@so/observability';
import authModule from '@so/auth';
import automationsModule from '../src/index.js';

const config = createConfig({
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so',
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'localhost:9000', S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin', S3_BUCKET: process.env.S3_BUCKET ?? 'so-datasets',
  ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: 'admin',
});
let server: AppServer;
afterAll(async () => { await server?.stop(); });
function cookieFrom(s: string | string[] | undefined): string { const raw = Array.isArray(s) ? s[0]! : s!; return raw.split(';')[0]!; }

describe('automations: project scoping', () => {
  it('list is scoped by X-Project', async () => {
    server = await createServer({ modules: [authModule, automationsModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();
    await server.kernel.ctx.db.query(`DELETE FROM automations WHERE name IN ('autoA','autoB')`);
    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const cookie = cookieFrom(login.headers['set-cookie']);

    await server.app.inject({ method: 'POST', url: '/api/automations', headers: { cookie, 'x-project': 'projA' }, payload: { name: 'autoA', triggerAction: 'tA', thenAction: 'tB', thenEdits: {} } });
    await server.app.inject({ method: 'POST', url: '/api/automations', headers: { cookie, 'x-project': 'projB' }, payload: { name: 'autoB', triggerAction: 'tA', thenAction: 'tB', thenEdits: {} } });

    const listA = (await server.app.inject({ method: 'GET', url: '/api/automations', headers: { cookie, 'x-project': 'projA' } })).json().automations as Array<{ name: string }>;
    expect(listA.map((x) => x.name)).toContain('autoA');
    expect(listA.map((x) => x.name)).not.toContain('autoB');
  });
});
```

- [ ] **Step 5: Run → PASS:** `pnpm --filter @so/automations test` (timeout 180000). typecheck clean.

- [ ] **Step 6: Commit:** `git add -A && git commit -m "feat(automations): project-scope create+list (X-Project)"`

---

## Task 4: Full verification + merge (GATED)
- [ ] `pnpm run infra:up && pnpm run infra:seed && pnpm typecheck; pnpm lint`; then `pnpm test >/tmp/v.log 2>&1; t=$?; grep -E "Tests +[0-9]+ (passed|failed)" /tmp/v.log | tail -1`. **Only if typecheck, lint, and `t` all 0**: `git checkout main && git merge --ff-only phase39/scope-pipelines-apps-automations`. (No-header requests default to `project_default`, so existing tests stay green.)

---

## Self-review
- **Pattern applied** — pipelines/apps/automations now project-scope `create`+`list`, like datasets. ✓
- **Backward-compatible** — `project_id` defaults; no-header ⇒ Default; existing suites unaffected. ✓
- **Contained** — only `create`/`list` signatures change (called only by each module's routes); run/get/update/delete-by-id + the automations event trigger untouched. ✓
- **Deferred:** pipeline `run()` input-resolution + output-dataset project-stamping (outputs default to `project_default`); connector scoping (Plan 40); get/update/delete-by-id project enforcement. Flagged.
