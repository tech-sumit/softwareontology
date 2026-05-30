# Phase 31 — Pipeline Scheduling (activate the worker) Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps `- [ ]`.

**Goal:** Pipelines can carry a **cron schedule**; the (currently idle) `@so/worker` runs them on time. Introduces a generic `schedules` contribution: the worker registers each on pg-boss cron. A pipeline `pipeline.tick` job runs every minute and executes any pipeline whose cron is due (recording a `trigger='schedule'` run via Phase 29).

**Architecture:** New `schedules` extension slot (sdk + kernel + worker). `@so/pipelines` gains `schedule`/`last_run_at` columns, a `scheduler.ts` (pure `isDue` + `runDuePipelines`), set/clear-schedule API, and contributes `jobs: [pipeline.tick]` + `schedules: [{pipeline.tick, '* * * * *'}]`. Scheduling **logic** is unit/integration-tested directly (fixed clocks, no cron wait); the pg-boss cron glue is thin.

---

## Pre-flight
- [ ] **Branch:** `git checkout main && git checkout -b phase31/pipeline-scheduling`

---

## Task 1: The `schedules` extension slot (sdk + kernel + worker)

**Files:** Modify `packages/sdk/src/types.ts`, `packages/kernel/src/kernel.ts`, `packages/worker/src/worker.ts`

- [ ] **Step 1: SDK — modify `packages/sdk/src/types.ts`**

Extend the `ContributionSlot` union to include `'schedules'`:
```ts
export type ContributionSlot =
  | 'objectTypes' | 'linkTypes' | 'actions' | 'functions'
  | 'connectors' | 'jobs' | 'permissions' | 'schedules';
```
Add the type (after `JobDefinition`):
```ts
export interface ScheduleDefinition { name: string; cron: string; }
```
Add `schedules?` to `Contributions` (after `jobs?: JobDefinition[];`):
```ts
  schedules?: ScheduleDefinition[];
```

- [ ] **Step 2: Kernel — modify `packages/kernel/src/kernel.ts`**

Add `'schedules'` to the `ARRAY_SLOTS` array:
```ts
const ARRAY_SLOTS: ContributionSlot[] = [
  'objectTypes', 'linkTypes', 'actions', 'functions', 'connectors', 'jobs', 'permissions', 'schedules',
];
```

- [ ] **Step 3: Worker — modify `packages/worker/src/worker.ts`**

Add `ScheduleDefinition` to the type import from `@so/sdk` (it currently imports `ModuleDefinition, ModuleContext, Config, Logger, JobDefinition`). Then, inside `start()`, AFTER the `for (const job of jobs)` loop and before the closing of `start`, add:
```ts
      const schedules = kernel.registry.get<ScheduleDefinition>('schedules');
      for (const sched of schedules) {
        await boss.schedule(sched.name, sched.cron);
        logger.info('schedule bound', { name: sched.name, cron: sched.cron });
      }
```
(The schedule fires the same-named queue, which a `jobs` entry must have created — order is correct: jobs first, then schedules.)

- [ ] **Step 4: Verify the worker still works:** `pnpm run infra:up && pnpm --filter @so/worker test` (timeout 120000) — the existing worker test (a module with `jobs` but no `schedules`) stays green (the schedules loop no-ops). typecheck `@so/sdk`, `@so/kernel`, `@so/worker` clean.

- [ ] **Step 5: Commit:** `git add -A && git commit -m "feat(sdk,kernel,worker): generic schedules contribution (pg-boss cron)"`

---

## Task 2: Pipeline scheduling in `@so/pipelines`

**Files:** Modify `packages/pipelines/package.json`, `packages/pipelines/src/migrate.ts`, `packages/pipelines/src/service.ts`, `packages/pipelines/src/routes.ts`, `packages/pipelines/src/index.ts`; Create `packages/pipelines/src/scheduler.ts`, `packages/pipelines/test/scheduler.test.ts`, `packages/pipelines/test/pipeline-schedule.int.test.ts`

- [ ] **Step 1: Dependency — modify `packages/pipelines/package.json`**

Add to `dependencies`: `"cron-parser": "^5.1.0"`. Then run `pnpm install`.
> cron-parser v5 API: `import { CronExpressionParser } from 'cron-parser';` then `CronExpressionParser.parse(cron, { currentDate: now })`. If `pnpm install` resolves v4 instead, use `import parser from 'cron-parser'; parser.parseExpression(cron, { currentDate: now })` and note it.

- [ ] **Step 2: Columns — modify `packages/pipelines/src/migrate.ts`**

Append two statements to the `MIGRATIONS` array:
```ts
  `ALTER TABLE pipelines ADD COLUMN IF NOT EXISTS schedule text`,
  `ALTER TABLE pipelines ADD COLUMN IF NOT EXISTS last_run_at timestamptz`,
```

- [ ] **Step 3: Create `packages/pipelines/src/scheduler.ts`**
```ts
import { CronExpressionParser } from 'cron-parser';
import type { ModuleContext } from '@so/sdk';
import { createPipelineService } from './service.js';

/** Most recent scheduled time <= now; due if we haven't run since then. */
export function isDue(cron: string, lastRunAt: Date | null, now: Date): boolean {
  const prev = CronExpressionParser.parse(cron, { currentDate: now }).prev().toDate();
  return lastRunAt === null || lastRunAt.getTime() < prev.getTime();
}

/** Run every scheduled pipeline whose cron is due; returns the ids that ran. */
export async function runDuePipelines(ctx: ModuleContext, now: Date): Promise<string[]> {
  const svc = createPipelineService(ctx);
  const rows = await ctx.db.query<{ id: string; org_id: string; schedule: string; last_run_at: string | null }>(
    `SELECT id, org_id, schedule, last_run_at FROM pipelines WHERE schedule IS NOT NULL`,
  );
  const ran: string[] = [];
  for (const r of rows) {
    if (!isDue(r.schedule, r.last_run_at ? new Date(r.last_run_at) : null, now)) continue;
    try { await svc.run(r.org_id, r.id, 'schedule'); } catch { /* run() already recorded the failure */ }
    await ctx.db.query(`UPDATE pipelines SET last_run_at = $1 WHERE id = $2`, [now.toISOString(), r.id]);
    ran.push(r.id);
  }
  return ran;
}
```

- [ ] **Step 4: Validation + set/clear — modify `packages/pipelines/src/service.ts`**

Add the import at the top:
```ts
import { CronExpressionParser } from 'cron-parser';
```
Add a validator after `guardSql`:
```ts
function validateCron(cron: string): void {
  try { CronExpressionParser.parse(cron); } catch { throw new Error('invalid cron expression'); }
}
```
Add two methods (before the `return { ... }`):
```ts
  async function setSchedule(orgId: string, id: string, cron: string): Promise<boolean> {
    validateCron(cron);
    const r = await ctx.db.query<{ id: string }>(`UPDATE pipelines SET schedule = $1 WHERE org_id = $2 AND id = $3 RETURNING id`, [cron, orgId, id]);
    return r.length > 0;
  }
  async function clearSchedule(orgId: string, id: string): Promise<boolean> {
    const r = await ctx.db.query<{ id: string }>(`UPDATE pipelines SET schedule = NULL, last_run_at = NULL WHERE org_id = $1 AND id = $2 RETURNING id`, [orgId, id]);
    return r.length > 0;
  }
```
Update the return to `return { createPipeline, listPipelines, run, listRuns, getRun, setSchedule, clearSchedule };`

- [ ] **Step 5: Routes — modify `packages/pipelines/src/routes.ts`**

After the runs routes, add:
```ts
  fastify.put('/:id/schedule', { preHandler: requirePermission('pipelines:write') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { cron?: string };
    if (!body?.cron) return reply.code(400).send({ error: 'cron required' });
    try { const ok = await svc.setSchedule(req.user!.orgId, id, body.cron); return ok ? reply.send({ ok: true }) : reply.code(404).send({ error: 'pipeline not found' }); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  fastify.delete('/:id/schedule', { preHandler: requirePermission('pipelines:write') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const ok = await svc.clearSchedule(req.user!.orgId, id);
    return ok ? reply.send({ ok: true }) : reply.code(404).send({ error: 'pipeline not found' });
  });
```

- [ ] **Step 6: Contribute the job + schedule — modify `packages/pipelines/src/index.ts`**

Add the import:
```ts
import { runDuePipelines } from './scheduler.js';
```
Change `contributes` to add `jobs` + `schedules`:
```ts
  contributes: {
    apiRoutes: pipelineRoutes,
    permissions: ['pipelines:read', 'pipelines:write'],
    jobs: [{ name: 'pipeline.tick', handler: async (ctx) => { await runDuePipelines(ctx, new Date()); } }],
    schedules: [{ name: 'pipeline.tick', cron: '* * * * *' }],
  },
```
Also export the scheduler helpers (after the existing export):
```ts
export { isDue, runDuePipelines } from './scheduler.js';
```

- [ ] **Step 7: Create `packages/pipelines/test/scheduler.test.ts`** (pure unit — no infra)
```ts
import { describe, it, expect } from 'vitest';
import { isDue } from '../src/scheduler.js';

describe('isDue', () => {
  const now = new Date('2026-05-30T12:00:30Z');
  it('is due when never run', () => { expect(isDue('* * * * *', null, now)).toBe(true); });
  it('is due when last run was before this minute', () => { expect(isDue('* * * * *', new Date('2026-05-30T11:59:00Z'), now)).toBe(true); });
  it('is not due when already run this minute', () => { expect(isDue('* * * * *', new Date('2026-05-30T12:00:05Z'), now)).toBe(false); });
  it('every-5-min: not due at 12:02 when last ran 12:00', () => { expect(isDue('*/5 * * * *', new Date('2026-05-30T12:00:10Z'), new Date('2026-05-30T12:02:00Z'))).toBe(false); });
  it('every-5-min: due at 12:05 when last ran 12:00', () => { expect(isDue('*/5 * * * *', new Date('2026-05-30T12:00:10Z'), new Date('2026-05-30T12:05:30Z'))).toBe(true); });
});
```

- [ ] **Step 8: Create `packages/pipelines/test/pipeline-schedule.int.test.ts`**
```ts
import { describe, it, expect, afterAll } from 'vitest';
import { createServer, createConfig, type AppServer } from '@so/server';
import { createLogger } from '@so/observability';
import authModule from '@so/auth';
import datasetsModule from '@so/datasets';
import pipelinesModule, { runDuePipelines } from '../src/index.js';

const config = createConfig({
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so',
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'localhost:9000', S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin', S3_BUCKET: process.env.S3_BUCKET ?? 'so-datasets',
  ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: 'admin',
});
let server: AppServer;
afterAll(async () => { await server?.stop(); });
function cookieFrom(s: string | string[] | undefined): string { const raw = Array.isArray(s) ? s[0]! : s!; return raw.split(';')[0]!; }

describe('pipeline scheduling', () => {
  it('sets a cron, runs a due pipeline once, and does not double-run within the period', async () => {
    server = await createServer({ modules: [authModule, datasetsModule, pipelinesModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();
    await server.kernel.ctx.db.query(`DELETE FROM pipelines WHERE name='schedpipe'`);

    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const a = { cookie: cookieFrom(login.headers['set-cookie']) };
    await server.app.inject({ method: 'POST', url: '/api/datasets?name=schedflights&format=csv', headers: { ...a, 'content-type': 'text/csv' }, payload: 'flight_no,status\nFL-1,Delayed\nFL-2,Boarding\n' });
    const create = await server.app.inject({ method: 'POST', url: '/api/pipelines', headers: a, payload: { name: 'schedpipe', inputs: ['schedflights'], sql: 'SELECT * FROM schedflights' } });
    const pipeId = create.json().id;

    // invalid cron rejected; valid cron set
    const badCron = await server.app.inject({ method: 'PUT', url: `/api/pipelines/${pipeId}/schedule`, headers: a, payload: { cron: 'not-a-cron' } });
    expect(badCron.statusCode).toBe(400);
    const setCron = await server.app.inject({ method: 'PUT', url: `/api/pipelines/${pipeId}/schedule`, headers: a, payload: { cron: '* * * * *' } });
    expect(setCron.statusCode).toBe(200);

    // run the scheduler tick logic directly with fixed clocks (no cron wait)
    const T1 = new Date('2026-05-30T12:00:30Z');
    const ran1 = await runDuePipelines(server.kernel.ctx, T1);
    expect(ran1).toContain(pipeId);

    const runs = await server.app.inject({ method: 'GET', url: `/api/pipelines/${pipeId}/runs`, headers: a });
    expect(runs.json().runs[0].trigger).toBe('schedule');
    expect(runs.json().runs[0].status).toBe('success');

    // same minute -> not due again (no double run)
    const T2 = new Date('2026-05-30T12:00:45Z');
    const ran2 = await runDuePipelines(server.kernel.ctx, T2);
    expect(ran2).not.toContain(pipeId);
  });
});
```

- [ ] **Step 9: Run the FULL pipelines suite (regression) → PASS:** `pnpm run infra:up && pnpm --filter @so/pipelines test` (timeout 180000) — existing tests (single-sql, DAG, runs, expectations) PLUS scheduler unit + schedule int test pass. typecheck clean; no unused imports.

- [ ] **Step 10: Commit:** `git add -A && git commit -m "feat(pipelines): cron scheduling via the worker (schedule API + tick)"`

---

## Task 3: Full verification + merge
- [ ] `pnpm run infra:up && pnpm run infra:seed && pnpm typecheck; pnpm lint; pnpm test` (exit codes) → green (sdk/kernel/worker changes are additive — confirm the worker + e2e suites still pass). `git checkout main && git merge --ff-only phase31/pipeline-scheduling`

---

## Self-review
- **Pipeline maturity (scheduling)** — cron schedule per pipeline; the worker (previously idle) fires a per-minute tick that runs due pipelines, recording `trigger='schedule'` runs. The idle worker now does real work. ✓
- **Generic & reusable** — `schedules` is a first-class contribution slot any module can use, not a pipelines special-case. ✓
- **Tested without timing flakiness** — `isDue` unit-tested with fixed clocks; `runDuePipelines` integration-tested with explicit `now` values (runs once, no double-run); pg-boss cron glue is thin and the worker suite still passes. ✓
- **Additive** — sdk/kernel/worker changes are purely additive (new optional slot); existing modules/tests unaffected. ✓
- **Deferred:** catch-up/backfill for long outages, per-pipeline timezones, schedule overlap/locking (skip if a prior run is still going), surfacing next-run time in the UI, distributed multi-worker coordination (pg-boss already supports it). Flagged.
