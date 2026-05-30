# Phase 30 — Pipeline Data-Quality Expectations Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps `- [ ]`.

**Goal:** Pipelines can declare **expectations** (data-quality assertions) on their output. Before the derived dataset is registered, each expectation is evaluated against the built result; any violation **fails the build** — recorded in `pipeline_runs` (status `failed`, error) with **no dataset emitted**.

**Architecture:** Additive to merged `@so/pipelines` (post-Phase-29). New `expectations jsonb` column. Supported checks: `row_count_min`, `row_count_max`, `not_null(column)`, `unique(column)`. Evaluated in `run()` after the output is built/counted but **before** `COPY`/dataset registration, so a failure throws into the existing run-recording catch.

---

## Pre-flight
- [ ] **Branch:** `git checkout main && git checkout -b phase30/pipeline-expectations`

---

## Task 1: Expectations in `@so/pipelines`

**Files:** Modify `packages/pipelines/src/migrate.ts`, `packages/pipelines/src/service.ts`, `packages/pipelines/src/index.ts`; Create `packages/pipelines/test/pipeline-expectations.int.test.ts`

- [ ] **Step 1: Add the column — modify `packages/pipelines/src/migrate.ts`**

Append one statement to the `MIGRATIONS` array (after the `pipeline_runs` table):
```ts
  `ALTER TABLE pipelines ADD COLUMN IF NOT EXISTS expectations jsonb`,
```
(Leave `runMigrations` calling `applyMigrations(db, 'pipelines', MIGRATIONS)` unchanged — the shared helper serializes it.)

- [ ] **Step 2: Type + validate — modify `packages/pipelines/src/service.ts`**

Add the type + extend `PipelineInput` (after the existing `PipelineStep`/`PipelineInput`):
```ts
export interface Expectation { type: 'row_count_min' | 'row_count_max' | 'not_null' | 'unique'; value?: number; column?: string; }
```
Change `PipelineInput` to:
```ts
export interface PipelineInput { name: string; inputs: string[]; sql?: string; steps?: PipelineStep[]; expectations?: Expectation[]; }
```
Add a validator (module-level, after `guardSql`):
```ts
const EXP_TYPES = ['row_count_min', 'row_count_max', 'not_null', 'unique'];
function validateExpectations(input: unknown): Expectation[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw new Error('expectations must be an array');
  const out: Expectation[] = [];
  for (const e of input) {
    const exp = (e ?? {}) as { type?: string; value?: number; column?: string };
    if (!EXP_TYPES.includes(exp.type as string)) throw new Error(`unknown expectation type: ${String(exp.type)}`);
    if (exp.type === 'row_count_min' || exp.type === 'row_count_max') {
      if (typeof exp.value !== 'number' || !Number.isFinite(exp.value)) throw new Error(`${exp.type} requires a numeric value`);
      out.push({ type: exp.type, value: exp.value });
    } else {
      if (!exp.column || !NAME_RE.test(exp.column)) throw new Error(`${exp.type} requires a valid column name`);
      out.push({ type: exp.type as Expectation['type'], column: exp.column });
    }
  }
  return out;
}
```

- [ ] **Step 3: Store on create — modify `createPipeline` in `service.ts`**

After the `hasSteps` validation block and before `const id = randomUUID();`, add:
```ts
    const expectations = validateExpectations(input.expectations);
```
Replace the `INSERT INTO pipelines(...)` with the expectations-aware version:
```ts
    await ctx.db.query(
      `INSERT INTO pipelines(id,org_id,name,sql,inputs,steps,expectations) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, orgId, input.name, input.sql ?? '', JSON.stringify(input.inputs), hasSteps ? JSON.stringify(input.steps) : null, expectations.length ? JSON.stringify(expectations) : null],
    );
```

- [ ] **Step 4: Evaluate before registering — modify `run` in `service.ts`**

Change the pipeline SELECT to also fetch `expectations`:
```ts
    const p = await ctx.db.query<{ name: string; sql: string; inputs: string[]; steps: PipelineStep[] | null; expectations: Expectation[] | null }>(
      `SELECT name, sql, inputs, steps, expectations FROM pipelines WHERE org_id = $1 AND id = $2`, [orgId, pipelineId],
    );
```
In the build block, replace these three lines:
```ts
        const described = await session.all(`DESCRIBE _out`);
        const counted = await session.all(`SELECT count(*)::int AS n FROM _out`);
        await session.all(`COPY _out TO '${s3url}' (FORMAT parquet)`);
        const rowCount = Number(counted[0]?.n ?? 0);
```
with (count first, gate, THEN copy):
```ts
        const described = await session.all(`DESCRIBE _out`);
        const counted = await session.all(`SELECT count(*)::int AS n FROM _out`);
        const rowCount = Number(counted[0]?.n ?? 0);
        for (const exp of pipe.expectations ?? []) {
          if (exp.type === 'row_count_min' && rowCount < (exp.value ?? 0)) throw new Error(`expectation failed: row_count_min(${exp.value}) — got ${rowCount}`);
          if (exp.type === 'row_count_max' && rowCount > (exp.value ?? 0)) throw new Error(`expectation failed: row_count_max(${exp.value}) — got ${rowCount}`);
          if (exp.type === 'not_null') {
            const r = await session.all(`SELECT count(*)::int AS n FROM _out WHERE ${exp.column} IS NULL`);
            if (Number((r[0] as { n?: number })?.n ?? 0) > 0) throw new Error(`expectation failed: not_null(${exp.column})`);
          }
          if (exp.type === 'unique') {
            const r = await session.all(`SELECT (count(*) - count(DISTINCT ${exp.column}))::int AS d FROM _out`);
            if (Number((r[0] as { d?: number })?.d ?? 0) > 0) throw new Error(`expectation failed: unique(${exp.column})`);
          }
        }
        await session.all(`COPY _out TO '${s3url}' (FORMAT parquet)`);
```
(Everything after — `INSERT INTO datasets`, column inserts, `UPDATE pipeline_runs ... success` — is unchanged and now only runs when expectations pass. Column names in `not_null`/`unique` are validated by `validateExpectations`, so the interpolation is safe.)

- [ ] **Step 5: Export the type — modify `packages/pipelines/src/index.ts`**

Change the export line to include `Expectation`:
```ts
export { createPipelineService, type PipelineInput, type PipelineStep, type Expectation } from './service.js';
```

- [ ] **Step 6: Create `packages/pipelines/test/pipeline-expectations.int.test.ts`**
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

describe('pipeline expectations: data-quality gates', () => {
  it('passes a met expectation, fails an unmet one (no dataset), rejects unknown types', async () => {
    server = await createServer({ modules: [authModule, datasetsModule, pipelinesModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();
    await server.kernel.ctx.db.query(`DELETE FROM pipelines WHERE name IN ('goodq','badq','unkq')`);

    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const a = { cookie: cookieFrom(login.headers['set-cookie']) };
    await server.app.inject({ method: 'POST', url: '/api/datasets?name=qflights&format=csv', headers: { ...a, 'content-type': 'text/csv' }, payload: 'flight_no,status\nFL-1,Delayed\nFL-2,Boarding\nFL-3,Delayed\n' });

    // PASS: row_count_min met
    const good = await server.app.inject({ method: 'POST', url: '/api/pipelines', headers: a, payload: { name: 'goodq', inputs: ['qflights'], sql: 'SELECT * FROM qflights', expectations: [{ type: 'row_count_min', value: 1 }] } });
    const goodRun = await server.app.inject({ method: 'POST', url: `/api/pipelines/${good.json().id}/run`, headers: a });
    expect(goodRun.statusCode).toBe(200);

    // FAIL: not_null violated (NULLIF makes 2 nulls) -> build fails, no dataset
    const bad = await server.app.inject({ method: 'POST', url: '/api/pipelines', headers: a, payload: { name: 'badq', inputs: ['qflights'], sql: "SELECT flight_no, NULLIF(status, 'Delayed') AS s FROM qflights", expectations: [{ type: 'not_null', column: 's' }] } });
    const badId = bad.json().id;
    const badRun = await server.app.inject({ method: 'POST', url: `/api/pipelines/${badId}/run`, headers: a });
    expect(badRun.statusCode).toBe(400);
    const runs = await server.app.inject({ method: 'GET', url: `/api/pipelines/${badId}/runs`, headers: a });
    expect(runs.json().runs[0].status).toBe('failed');
    expect(runs.json().runs[0].error).toMatch(/not_null/);
    expect(runs.json().runs[0].datasetId).toBeNull(); // no dataset registered

    // REJECT: unknown expectation type at create time
    const unk = await server.app.inject({ method: 'POST', url: '/api/pipelines', headers: a, payload: { name: 'unkq', inputs: ['qflights'], sql: 'SELECT * FROM qflights', expectations: [{ type: 'frobnicate' }] } });
    expect(unk.statusCode).toBe(400);
  });
});
```

- [ ] **Step 7: Run the FULL pipelines suite (regression) → PASS:** `pnpm run infra:up && pnpm --filter @so/pipelines test` (timeout 180000) — existing single-sql + DAG + runs tests PLUS the new expectations test pass. typecheck clean; no unused imports.

- [ ] **Step 8: Commit:** `git add -A && git commit -m "feat(pipelines): data-quality expectation gates (row-count/not-null/unique)"`

---

## Task 2: Full verification + merge
- [ ] `pnpm run infra:up && pnpm run infra:seed && pnpm typecheck; pnpm lint; pnpm test` (exit codes) → green; `git checkout main && git merge --ff-only phase30/pipeline-expectations`

---

## Self-review
- **Pipeline maturity (data quality)** — declarative expectations gate the build; violations fail the run with a clear error and emit no dataset. ✓
- **Backward-compatible** — `expectations` optional; pipelines without it behave exactly as before; gate runs only when present. ✓
- **Safe** — column names validated against `NAME_RE` before interpolation; row-count checks use the already-computed count. ✓
- **Records into Phase 29** — failures land in `pipeline_runs` (status/error), so build health already surfaces them. ✓
- **Deferred:** more checks (regex/range/accepted-values/referential), warn-vs-fail severity, quarantine table for bad rows, expectation results persisted per run. Flagged.
