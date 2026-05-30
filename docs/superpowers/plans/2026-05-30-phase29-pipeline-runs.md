# Phase 29 — Pipeline Runs & Build Health Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps `- [ ]`.

**Goal:** Every pipeline run is recorded — status (`running`/`success`/`failed`), trigger, timing, output dataset, row count, and error. Expose run history. This is the foundation for data-quality gates (Plan 30) and scheduling (Plan 31), which both write into it.

**Architecture:** Additive to merged `@so/pipelines`. New `pipeline_runs` table. `run()` creates a `running` row, then marks it `success` (with dataset/row_count) or `failed` (with error) — and still returns `{ datasetId, rowCount }` plus a new `runId` (backward compatible). New read endpoints for history.

---

## Pre-flight
- [ ] **Branch:** `git checkout main && git checkout -b phase29/pipeline-runs`

---

## Task 1: Record runs in `@so/pipelines`

**Files:** Modify `packages/pipelines/src/migrate.ts`, `packages/pipelines/src/service.ts`, `packages/pipelines/src/routes.ts`; Create `packages/pipelines/test/pipeline-runs.int.test.ts`

- [ ] **Step 1: Add the table — modify `packages/pipelines/src/migrate.ts`**

After the `ALTER TABLE pipelines ADD COLUMN IF NOT EXISTS steps jsonb` line, add:
```ts
  await db.query(`CREATE TABLE IF NOT EXISTS pipeline_runs (
    id text PRIMARY KEY,
    pipeline_id text NOT NULL,
    org_id text NOT NULL,
    status text NOT NULL,
    trigger text NOT NULL DEFAULT 'manual',
    dataset_id text,
    row_count integer,
    error text,
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz
  )`);
```

- [ ] **Step 2: Record runs — modify `packages/pipelines/src/service.ts`**

Change the `run` signature to accept a trigger and wrap the build so failures are recorded. Replace the whole `async function run(...)` with:
```ts
  async function run(orgId: string, pipelineId: string, trigger = 'manual'): Promise<{ datasetId: string; rowCount: number; runId: string }> {
    const p = await ctx.db.query<{ name: string; sql: string; inputs: string[]; steps: PipelineStep[] | null }>(
      `SELECT name, sql, inputs, steps FROM pipelines WHERE org_id = $1 AND id = $2`, [orgId, pipelineId],
    );
    const pipe = p[0];
    if (!pipe) throw new Error('pipeline not found');

    const runId = randomUUID();
    await ctx.db.query(`INSERT INTO pipeline_runs(id,pipeline_id,org_id,status,trigger) VALUES ($1,$2,$3,'running',$4)`, [runId, pipelineId, orgId, trigger]);
    try {
      const datasetId = randomUUID();
      const objectKey = `${orgId}/datasets/${datasetId}/data.parquet`;
      const s3url = ctx.objectStore.getObjectUrl(objectKey);
      const session = await ctx.query.open();
      try {
        for (const inputName of pipe.inputs) {
          if (!NAME_RE.test(inputName)) throw new Error(`invalid input name: ${inputName}`);
          const ds = await ctx.db.query<{ object_key: string }>(
            `SELECT object_key FROM datasets WHERE org_id = $1 AND name = $2 ORDER BY created_at DESC LIMIT 1`,
            [orgId, inputName],
          );
          if (!ds[0]) throw new Error(`input dataset not found: ${inputName}`);
          const url = ctx.objectStore.getObjectUrl(ds[0].object_key);
          await session.all(`CREATE OR REPLACE VIEW ${inputName} AS SELECT * FROM read_parquet('${url}')`);
        }
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
        const described = await session.all(`DESCRIBE _out`);
        const counted = await session.all(`SELECT count(*)::int AS n FROM _out`);
        await session.all(`COPY _out TO '${s3url}' (FORMAT parquet)`);
        const rowCount = Number(counted[0]?.n ?? 0);

        await ctx.db.query(`INSERT INTO datasets(id,org_id,name,object_key,row_count) VALUES ($1,$2,$3,$4,$5)`, [datasetId, orgId, pipe.name, objectKey, rowCount]);
        for (let i = 0; i < described.length; i++) {
          const col = described[i]!;
          await ctx.db.query(`INSERT INTO dataset_columns(dataset_id,ordinal,name,duck_type) VALUES ($1,$2,$3,$4)`, [datasetId, i, String(col.column_name), String(col.column_type)]);
        }
        await ctx.db.query(`UPDATE pipeline_runs SET status='success', dataset_id=$1, row_count=$2, finished_at=now() WHERE id=$3`, [datasetId, rowCount, runId]);
        return { datasetId, rowCount, runId };
      } finally {
        await session.close();
      }
    } catch (e) {
      await ctx.db.query(`UPDATE pipeline_runs SET status='failed', error=$1, finished_at=now() WHERE id=$2`, [(e as Error).message, runId]);
      throw e;
    }
  }
```

Add two read methods (before `return { ... }`):
```ts
  async function listRuns(orgId: string, pipelineId: string): Promise<Array<{ id: string; status: string; trigger: string; datasetId: string | null; rowCount: number | null; error: string | null; startedAt: string; finishedAt: string | null }>> {
    const rows = await ctx.db.query<{ id: string; status: string; trigger: string; dataset_id: string | null; row_count: number | null; error: string | null; started_at: string; finished_at: string | null }>(
      `SELECT id, status, trigger, dataset_id, row_count, error, started_at, finished_at FROM pipeline_runs WHERE org_id = $1 AND pipeline_id = $2 ORDER BY started_at DESC LIMIT 50`, [orgId, pipelineId],
    );
    return rows.map((r) => ({ id: r.id, status: r.status, trigger: r.trigger, datasetId: r.dataset_id, rowCount: r.row_count, error: r.error, startedAt: r.started_at, finishedAt: r.finished_at }));
  }

  async function getRun(orgId: string, runId: string): Promise<{ id: string; pipelineId: string; status: string; trigger: string; datasetId: string | null; rowCount: number | null; error: string | null; startedAt: string; finishedAt: string | null } | null> {
    const rows = await ctx.db.query<{ id: string; pipeline_id: string; status: string; trigger: string; dataset_id: string | null; row_count: number | null; error: string | null; started_at: string; finished_at: string | null }>(
      `SELECT id, pipeline_id, status, trigger, dataset_id, row_count, error, started_at, finished_at FROM pipeline_runs WHERE org_id = $1 AND id = $2`, [orgId, runId],
    );
    const r = rows[0];
    return r ? { id: r.id, pipelineId: r.pipeline_id, status: r.status, trigger: r.trigger, datasetId: r.dataset_id, rowCount: r.row_count, error: r.error, startedAt: r.started_at, finishedAt: r.finished_at } : null;
  }
```
Update the return to `return { createPipeline, listPipelines, run, listRuns, getRun };`

- [ ] **Step 3: Add read routes — modify `packages/pipelines/src/routes.ts`**

After the `POST /:id/run` handler, add:
```ts
  fastify.get('/:id/runs', { preHandler: requirePermission('pipelines:read') }, async (req) => {
    const { id } = req.params as { id: string };
    return { runs: await svc.listRuns(req.user!.orgId, id) };
  });

  fastify.get('/runs/:runId', { preHandler: requirePermission('pipelines:read') }, async (req, reply) => {
    const { runId } = req.params as { runId: string };
    const r = await svc.getRun(req.user!.orgId, runId);
    return r ? reply.send(r) : reply.code(404).send({ error: 'run not found' });
  });
```

- [ ] **Step 4: Create `packages/pipelines/test/pipeline-runs.int.test.ts`**
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

describe('pipeline runs: build health', () => {
  it('records a successful run and a failed run with history', async () => {
    server = await createServer({ modules: [authModule, datasetsModule, pipelinesModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();
    await server.kernel.ctx.db.query(`DELETE FROM pipelines WHERE name IN ('goodrun','badrun')`);

    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const a = { cookie: cookieFrom(login.headers['set-cookie']) };
    await server.app.inject({ method: 'POST', url: '/api/datasets?name=runflights&format=csv', headers: { ...a, 'content-type': 'text/csv' }, payload: 'flight_no,status\nFL-1,Delayed\nFL-2,Boarding\n' });

    // success
    const good = await server.app.inject({ method: 'POST', url: '/api/pipelines', headers: a, payload: { name: 'goodrun', inputs: ['runflights'], sql: "SELECT * FROM runflights WHERE status = 'Delayed'" } });
    const goodId = good.json().id;
    const goodRun = await server.app.inject({ method: 'POST', url: `/api/pipelines/${goodId}/run`, headers: a });
    expect(goodRun.statusCode).toBe(200);
    expect(goodRun.json().runId).toBeTruthy();
    const goodRuns = await server.app.inject({ method: 'GET', url: `/api/pipelines/${goodId}/runs`, headers: a });
    expect(goodRuns.json().runs).toHaveLength(1);
    expect(goodRuns.json().runs[0].status).toBe('success');
    expect(goodRuns.json().runs[0].rowCount).toBe(1);

    const oneRun = await server.app.inject({ method: 'GET', url: `/api/pipelines/runs/${goodRun.json().runId}`, headers: a });
    expect(oneRun.json().status).toBe('success');

    // failure (valid SQL, unknown column → DuckDB errors at build time)
    const bad = await server.app.inject({ method: 'POST', url: '/api/pipelines', headers: a, payload: { name: 'badrun', inputs: ['runflights'], sql: 'SELECT no_such_column FROM runflights' } });
    const badId = bad.json().id;
    const badRun = await server.app.inject({ method: 'POST', url: `/api/pipelines/${badId}/run`, headers: a });
    expect(badRun.statusCode).toBe(400);
    const badRuns = await server.app.inject({ method: 'GET', url: `/api/pipelines/${badId}/runs`, headers: a });
    expect(badRuns.json().runs[0].status).toBe('failed');
    expect(badRuns.json().runs[0].error).toBeTruthy();
  });
});
```

- [ ] **Step 5: Run the FULL pipelines suite (regression) → PASS:** `pnpm run infra:up && pnpm --filter @so/pipelines test` (timeout 180000) — existing single-sql + DAG tests PLUS the new runs test pass. typecheck clean; no unused imports.

- [ ] **Step 6: Commit:** `git add -A && git commit -m "feat(pipelines): record build runs + history (status/timing/error)"`

---

## Task 2: Full verification + merge
- [ ] `pnpm run infra:up && pnpm run infra:seed && pnpm typecheck; pnpm lint; pnpm test` (exit codes) → green. The added `runId` field in the run response is backward-compatible; confirm the existing pipeline + e2e tests still pass. Then `git checkout main && git merge --ff-only phase29/pipeline-runs`.

---

## Self-review
- **Pipeline maturity (build health)** — every run recorded with status/trigger/timing/dataset/row_count/error; history per pipeline + single-run lookup. ✓
- **Backward-compatible** — `run()` still returns `datasetId`/`rowCount` (adds `runId`); failures now recorded then re-thrown (route still 400s). Existing tests unaffected. ✓
- **Foundation for Plans 30–31** — `trigger` param ('manual'/'schedule') and the runs table are what quality-gates and the scheduler write into. ✓
- **Deferred:** run cancellation, log capture, retry/backfill, per-run metrics/duration surfacing in UI. Flagged.
