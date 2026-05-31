# Phase 32 — Incremental Pipeline Builds Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps `- [ ]`.

**Goal:** Incremental pipelines process only **new input rows** since the last run (by a monotonic **watermark column**) and **append** the result as a new Parquet *part* to a stable output dataset — no full re-read/re-transform of old input, no output rewrite.

**Architecture:** Additive to merged `@so/pipelines`. A pipeline can be `incremental` with a `watermark_column`; it tracks `last_watermark` + a stable `output_dataset_id`. On run, the single input view is filtered to `watermark > last_watermark`, the transform produces a delta, and the delta is written to `…/datasets/{outId}/parts/{runId}.parquet`. The output dataset's `object_key` is the **glob** `…/parts/*.parquet` (DuckDB reads all parts as one — verified). Build health (Phase 29) records each run; `trigger='schedule'` (Phase 31) makes scheduled incremental loops work.

> **Verified prerequisite:** `read_parquet('s3://…/parts/*.parquet')` over MinIO returns all parts (spiked: 2 parts → 2 rows, max ok).
> **Honest scope:** single-input, append-only (most ETL). Multi-input incremental, expectations-on-deltas, and a reset endpoint are deferred.

---

## Pre-flight
- [ ] **Branch:** `git checkout main && git checkout -b phase32/pipeline-incremental`

---

## Task 1: Incremental builds in `@so/pipelines`

**Files:** Modify `packages/pipelines/src/migrate.ts`, `packages/pipelines/src/service.ts`; Create `packages/pipelines/test/pipeline-incremental.int.test.ts`

- [ ] **Step 1: Columns — modify `packages/pipelines/src/migrate.ts`**

Append to the `MIGRATIONS` array:
```ts
  `ALTER TABLE pipelines ADD COLUMN IF NOT EXISTS incremental boolean NOT NULL DEFAULT false`,
  `ALTER TABLE pipelines ADD COLUMN IF NOT EXISTS watermark_column text`,
  `ALTER TABLE pipelines ADD COLUMN IF NOT EXISTS last_watermark text`,
  `ALTER TABLE pipelines ADD COLUMN IF NOT EXISTS output_dataset_id text`,
```

- [ ] **Step 2: Input type — modify `PipelineInput` in `packages/pipelines/src/service.ts`**
```ts
export interface PipelineInput { name: string; inputs: string[]; sql?: string; steps?: PipelineStep[]; expectations?: Expectation[]; incremental?: boolean; watermarkColumn?: string; }
```

- [ ] **Step 3: Validate + store on create — modify `createPipeline`**

After the `const expectations = validateExpectations(input.expectations);` line, add:
```ts
    if (input.incremental) {
      if (hasSteps || !input.sql) throw new Error('incremental pipelines require sql (not steps)');
      if (input.inputs.length !== 1) throw new Error('incremental pipelines require exactly one input');
      if (!input.watermarkColumn || !NAME_RE.test(input.watermarkColumn)) throw new Error('incremental pipelines require a valid watermarkColumn');
    }
```
Replace the `INSERT INTO pipelines(...)` with the incremental-aware version:
```ts
    await ctx.db.query(
      `INSERT INTO pipelines(id,org_id,name,sql,inputs,steps,expectations,incremental,watermark_column) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, orgId, input.name, input.sql ?? '', JSON.stringify(input.inputs), hasSteps ? JSON.stringify(input.steps) : null, expectations.length ? JSON.stringify(expectations) : null, input.incremental ?? false, input.watermarkColumn ?? null],
    );
```

- [ ] **Step 4: Fetch the new columns — modify the SELECT in `run`**

Replace the pipeline SELECT with:
```ts
    const p = await ctx.db.query<{ name: string; sql: string; inputs: string[]; steps: PipelineStep[] | null; expectations: Expectation[] | null; incremental: boolean; watermark_column: string | null; last_watermark: string | null; output_dataset_id: string | null }>(
      `SELECT name, sql, inputs, steps, expectations, incremental, watermark_column, last_watermark, output_dataset_id FROM pipelines WHERE org_id = $1 AND id = $2`, [orgId, pipelineId],
    );
```

- [ ] **Step 5: Incremental branch — modify `run`**

Immediately after `const session = await ctx.query.open();` and its `try {` line (i.e., as the FIRST thing inside that inner `try`, before the `for (const inputName of pipe.inputs)` loop), insert:
```ts
        if (pipe.incremental) {
          if (!pipe.watermark_column) throw new Error('incremental pipeline missing watermark column');
          const inputName = pipe.inputs[0]!;
          if (!NAME_RE.test(inputName)) throw new Error(`invalid input name: ${inputName}`);
          const ds = await ctx.db.query<{ object_key: string }>(
            `SELECT object_key FROM datasets WHERE org_id = $1 AND name = $2 ORDER BY created_at DESC LIMIT 1`, [orgId, inputName],
          );
          if (!ds[0]) throw new Error(`input dataset not found: ${inputName}`);
          const inUrl = ctx.objectStore.getObjectUrl(ds[0].object_key);
          const desc = await session.all(`DESCRIBE SELECT * FROM read_parquet('${inUrl}')`);
          const wm = desc.find((c) => String((c as { column_name?: string }).column_name) === pipe.watermark_column);
          if (!wm) throw new Error(`watermark column not found: ${pipe.watermark_column}`);
          const wmType = String((wm as { column_type?: string }).column_type);
          const filter = pipe.last_watermark != null ? ` WHERE ${pipe.watermark_column} > CAST('${pipe.last_watermark}' AS ${wmType})` : '';
          await session.all(`CREATE OR REPLACE VIEW ${inputName} AS SELECT * FROM read_parquet('${inUrl}')${filter}`);
          await session.all(`CREATE TEMP TABLE _delta AS ${pipe.sql}`);
          const dCount = Number((await session.all(`SELECT count(*)::int AS n FROM _delta`))[0]?.n ?? 0);
          const maxRow = await session.all(`SELECT max(${pipe.watermark_column})::VARCHAR AS w FROM ${inputName}`);
          const newMax = (maxRow[0] as { w?: string | null })?.w ?? null;

          let outId = pipe.output_dataset_id;
          if (!outId) {
            outId = randomUUID();
            await ctx.db.query(`INSERT INTO datasets(id,org_id,name,object_key,row_count) VALUES ($1,$2,$3,$4,0)`, [outId, orgId, pipe.name, `${orgId}/datasets/${outId}/parts/*.parquet`]);
            const cols = await session.all(`DESCRIBE _delta`);
            for (let i = 0; i < cols.length; i++) { const col = cols[i]!; await ctx.db.query(`INSERT INTO dataset_columns(dataset_id,ordinal,name,duck_type) VALUES ($1,$2,$3,$4)`, [outId, i, String(col.column_name), String(col.column_type)]); }
            await ctx.db.query(`UPDATE pipelines SET output_dataset_id = $1 WHERE id = $2`, [outId, pipelineId]);
          }
          const partUrl = ctx.objectStore.getObjectUrl(`${orgId}/datasets/${outId}/parts/${runId}.parquet`);
          await session.all(`COPY _delta TO '${partUrl}' (FORMAT parquet)`);
          await ctx.db.query(`UPDATE datasets SET row_count = row_count + $1 WHERE id = $2`, [dCount, outId]);
          if (newMax != null) await ctx.db.query(`UPDATE pipelines SET last_watermark = $1 WHERE id = $2`, [newMax, pipelineId]);
          await ctx.db.query(`UPDATE pipeline_runs SET status='success', dataset_id=$1, row_count=$2, finished_at=now() WHERE id=$3`, [outId, dCount, runId]);
          return { datasetId: outId, rowCount: dCount, runId };
        }
```
(The watermark column is validated by `NAME_RE` at create, so interpolation is safe. The existing non-incremental code below is unchanged and only runs when `pipe.incremental` is false. `datasetId`/`objectKey`/`s3url` declared above remain used by that path.)

- [ ] **Step 6: Create `packages/pipelines/test/pipeline-incremental.int.test.ts`**
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

describe('incremental pipeline builds', () => {
  it('processes only new rows by watermark and appends to a stable output', async () => {
    server = await createServer({ modules: [authModule, datasetsModule, pipelinesModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();
    await server.kernel.ctx.db.query(`DELETE FROM pipelines WHERE name='incpipe'`);

    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const a = { cookie: cookieFrom(login.headers['set-cookie']) };

    // first batch of source data
    await server.app.inject({ method: 'POST', url: '/api/datasets?name=incevents&format=csv', headers: { ...a, 'content-type': 'text/csv' }, payload: 'id,val\n1,a\n2,b\n3,c\n' });
    const create = await server.app.inject({ method: 'POST', url: '/api/pipelines', headers: a, payload: { name: 'incpipe', inputs: ['incevents'], sql: 'SELECT id, val FROM incevents', incremental: true, watermarkColumn: 'id' } });
    expect(create.statusCode).toBe(201);
    const pipeId = create.json().id;

    // run 1: first run has no watermark -> processes all 3
    const run1 = await server.app.inject({ method: 'POST', url: `/api/pipelines/${pipeId}/run`, headers: a });
    expect(run1.statusCode).toBe(200);
    expect(run1.json().rowCount).toBe(3);
    const outId = run1.json().datasetId;

    // new source batch contains ONLY the new rows (id 4,5)
    await server.app.inject({ method: 'POST', url: '/api/datasets?name=incevents&format=csv', headers: { ...a, 'content-type': 'text/csv' }, payload: 'id,val\n4,d\n5,e\n' });

    // run 2: watermark=3 -> processes only id 4,5 (delta = 2), same stable output dataset
    const run2 = await server.app.inject({ method: 'POST', url: `/api/pipelines/${pipeId}/run`, headers: a });
    expect(run2.json().rowCount).toBe(2);
    expect(run2.json().datasetId).toBe(outId); // stable output across runs

    // the output ACCUMULATED to 5 rows (1..5) — a full recompute of the latest source (4,5) would be only 2
    const preview = await server.app.inject({ method: 'GET', url: `/api/datasets/${outId}/preview`, headers: a });
    const ids = (preview.json().rows as Array<{ id: number }>).map((r) => Number(r.id)).sort((x, y) => x - y);
    expect(ids).toEqual([1, 2, 3, 4, 5]);
  });
});
```

- [ ] **Step 7: Run the FULL pipelines suite (regression) → PASS:** `pnpm run infra:up && pnpm --filter @so/pipelines test` (timeout 180000) — existing tests (single-sql, DAG, runs, expectations, scheduler, schedule) PLUS the new incremental test pass. typecheck clean; no unused imports.

- [ ] **Step 8: Commit:** `git add -A && git commit -m "feat(pipelines): incremental builds (watermark + append-only parts)"`

---

## Task 2: Full verification + merge
- [ ] `pnpm run infra:up && pnpm run infra:seed && pnpm typecheck; pnpm lint; pnpm test` (exit codes) → green. Incremental output datasets use a glob `object_key`; confirm dataset preview + (if modeled) ontology resolution read it transparently — the existing e2e + datasets tests must stay green. Then `git checkout main && git merge --ff-only phase32/pipeline-incremental`.

---

## Self-review
- **Pipeline maturity (incremental)** — only new input rows (by watermark) are transformed per run; results append as Parquet parts to a stable output dataset (glob), no full rewrite. Composes with scheduling (a scheduled incremental pipeline keeps catching up) and build health (each delta is a recorded run). ✓
- **Definitive test** — second source batch is `{4,5}` only, yet the output is `{1,2,3,4,5}` (5 rows), which only append-accumulation produces (a full recompute would yield 2). ✓
- **Append-only, verified** — DuckDB s3 glob over MinIO reads all parts (spiked); preview/resolution read via `read_parquet(object_key)`, so the glob is transparent. ✓
- **Safe** — `watermarkColumn` validated by `NAME_RE`; watermark literal cast to the column's DuckDB type. Non-incremental path untouched. ✓
- **Deferred:** multi-input incremental, expectations evaluated on deltas, compaction of many small parts, a reset/full-refresh endpoint, at-least-once dedup when the watermark isn't unique, watermark surfaced in the UI. Flagged.
