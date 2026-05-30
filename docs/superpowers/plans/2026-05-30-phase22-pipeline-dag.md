# Phase 22 (#2.1) — Multi-step Pipeline DAGs Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps `- [ ]`.

**Goal:** Pipelines with multiple chained steps (a mini-DAG). Each step is a named DuckDB view built from inputs and *earlier steps*; the last step's output is registered as the derived dataset. Backward-compatible with single-`sql` pipelines.

**Architecture:** Additive to merged `@so/pipelines` — `pipelines.steps jsonb` column; `createPipeline` accepts `sql` OR `steps[]`; `run` builds input views, then a view per step (`CREATE OR REPLACE VIEW <step> AS <sql>`), then `_out` from the last step. Single-`sql` pipelines unchanged.

---

## Pre-flight
- [ ] **Branch:** `git checkout main && git checkout -b phase22/pipeline-dag`

---

## Task 1: Multi-step pipelines in `@so/pipelines`

**Files:** Modify `packages/pipelines/src/migrate.ts`, `packages/pipelines/src/service.ts`, `packages/pipelines/src/routes.ts`; Create `packages/pipelines/test/pipeline-dag.int.test.ts`

- [ ] **Step 1: Add the column — modify `packages/pipelines/src/migrate.ts`**

After the `CREATE TABLE` for `pipelines`, add a second statement:
```ts
  await db.query(`ALTER TABLE pipelines ADD COLUMN IF NOT EXISTS steps jsonb`);
```

- [ ] **Step 2: Extend the service — modify `packages/pipelines/src/service.ts`**

Change `PipelineInput` to allow steps:
```ts
export interface PipelineStep { name: string; sql: string; }
export interface PipelineInput { name: string; inputs: string[]; sql?: string; steps?: PipelineStep[]; }
```
In `createPipeline`, replace the `guardSql(input.sql)` + INSERT with:
```ts
    const hasSteps = Array.isArray(input.steps) && input.steps.length > 0;
    if (hasSteps) {
      for (const s of input.steps!) { if (!NAME_RE.test(s.name)) throw new Error(`invalid step name: ${s.name}`); guardSql(s.sql); }
    } else {
      if (!input.sql) throw new Error('sql or steps required');
      guardSql(input.sql);
    }
    const id = randomUUID();
    await ctx.db.query(
      `INSERT INTO pipelines(id,org_id,name,sql,inputs,steps) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, orgId, input.name, input.sql ?? '', JSON.stringify(input.inputs), hasSteps ? JSON.stringify(input.steps) : null],
    );
    return id;
```
In `run`, change the SELECT to also fetch `steps` and replace the single `CREATE TEMP TABLE _out AS ${pipe.sql}` with the step-aware version. Update the query + the build:
```ts
    const p = await ctx.db.query<{ name: string; sql: string; inputs: string[]; steps: PipelineStep[] | null }>(
      `SELECT name, sql, inputs, steps FROM pipelines WHERE org_id = $1 AND id = $2`, [orgId, pipelineId],
    );
```
…and after creating the input views, replace the `_out` creation:
```ts
      if (pipe.steps && pipe.steps.length > 0) {
        for (const step of pipe.steps) {
          if (!NAME_RE.test(step.name)) throw new Error(`invalid step name: ${step.name}`);
          guardSql(step.sql);
          await session.all(`CREATE OR REPLACE VIEW ${step.name} AS ${step.sql}`);
        }
        await session.all(`CREATE TEMP TABLE _out AS SELECT * FROM ${pipe.steps[pipe.steps.length - 1]!.name}`);
      } else {
        guardSql(pipe.sql);
        await session.all(`CREATE TEMP TABLE _out AS ${pipe.sql}`);
      }
```
(Keep the rest of `run` — DESCRIBE/count/COPY/register — unchanged. Export `PipelineStep`.)

- [ ] **Step 3: Routes — modify `packages/pipelines/src/routes.ts`**

The create route currently requires `body.sql`. Relax it to accept either:
```ts
    if (!body?.name || !Array.isArray(body?.inputs) || (!body?.sql && !Array.isArray(body?.steps))) return reply.code(400).send({ error: 'name, inputs[], and sql or steps[] required' });
```
(The `body as Partial<PipelineInput>` already carries `steps`.)

- [ ] **Step 4: Create `packages/pipelines/test/pipeline-dag.int.test.ts`**
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

describe('pipeline DAG: chained steps', () => {
  it('runs a 2-step pipeline where step 2 reads step 1', async () => {
    server = await createServer({ modules: [authModule, datasetsModule, pipelinesModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();
    await server.kernel.ctx.db.query(`DELETE FROM pipelines WHERE name='dagpipe'`);

    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const a = { cookie: cookieFrom(login.headers['set-cookie']) };
    await server.app.inject({ method: 'POST', url: '/api/datasets?name=flightsdag&format=csv', headers: { ...a, 'content-type': 'text/csv' }, payload: 'flight_no,status\nFL-1,Delayed\nFL-2,Boarding\nFL-3,Delayed\n' });

    const create = await server.app.inject({ method: 'POST', url: '/api/pipelines', headers: a, payload: { name: 'dagpipe', inputs: ['flightsdag'], steps: [ { name: 'delayed', sql: "SELECT flight_no FROM flightsdag WHERE status = 'Delayed'" }, { name: 'counted', sql: 'SELECT count(*)::int AS n FROM delayed' } ] } });
    expect(create.statusCode).toBe(201);

    const run = await server.app.inject({ method: 'POST', url: `/api/pipelines/${create.json().id}/run`, headers: a });
    expect(run.statusCode).toBe(200);
    expect(run.json().rowCount).toBe(1); // counted has 1 row

    const preview = await server.app.inject({ method: 'GET', url: `/api/datasets/${run.json().datasetId}/preview`, headers: a });
    expect((preview.json().rows as Array<{ n: number }>)[0]!.n).toBe(2); // 2 delayed flights
  });
});
```

- [ ] **Step 5: Run the FULL pipelines suite (regression) → PASS:** `pnpm run infra:up && pnpm --filter @so/pipelines test` (timeout 180000) — the existing single-sql pipeline test PLUS the new DAG test pass. Then `pnpm --filter @so/pipelines run typecheck` clean. No unused imports.

- [ ] **Step 6: Commit:** `git add -A && git commit -m "feat(pipelines): multi-step pipeline DAGs (chained step views)"`

---

## Task 2: Full verification + merge
- [ ] `pnpm run infra:up && pnpm run infra:seed && pnpm typecheck; pnpm lint; pnpm test` (exit codes) → green; `git checkout main && git merge --ff-only phase22/pipeline-dag`

---

## Self-review
- **Spec §6 (pipelines/transforms)** — multi-step DAG within a pipeline; later steps reference earlier step views. ✓
- **Backward-compatible** — `steps` optional; single-`sql` path unchanged; existing pipeline test stays green. ✓
- **Security** — step names validated, every step SQL guarded (single statement, no comments, length cap). ✓
- **Deferred:** cross-pipeline DAG dependencies, scheduling (cron via worker), incremental builds, step-level materialization/caching. Flagged.
