# Phase 12 (2.3) — module-pipelines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** SQL transforms. A pipeline names input datasets + a `SELECT`; running it creates DuckDB views over the inputs' Parquet, runs the SQL, and registers the result as a new derived dataset — which can then be modeled as an ontology object type like any other.

**Architecture:** New `@so/pipelines` (dependsOn `datasets`, `auth`), self-contained (writes the stable `datasets`/`dataset_columns` schema via `ctx.db`, mirroring `@so/connectors-db`). Input dataset names + the pipeline SQL are admin-defined and guarded.

> **DRY debt (noted):** dataset registration (DuckDB → Parquet → register) now appears in `datasets.ingest`, `connectors.sync`, and here. A shared `ingestRelation` primitive is a Phase-2-hardening refactor; kept self-contained here to avoid touching merged code.

---

## Pre-flight
- [ ] **Branch:** `git checkout main && git checkout -b phase12/module-pipelines`

---

## Task 1: `@so/pipelines`

**Files:** Create `packages/pipelines/{package.json,tsconfig.json,vitest.config.ts,src/migrate.ts,src/service.ts,src/routes.ts,src/index.ts,test/pipelines.int.test.ts}`

- [ ] **Step 1: `packages/pipelines/package.json`**

```json
{
  "name": "@so/pipelines",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "dependencies": { "@so/sdk": "workspace:*", "@so/auth": "workspace:*", "fastify": "^5.2.0" },
  "devDependencies": { "@so/server": "workspace:*", "@so/observability": "workspace:*", "@so/datasets": "workspace:*", "@types/node": "^22.10.0", "@types/pg": "^8.11.0" }
}
```

- [ ] **Step 2: `pnpm install`**

- [ ] **Step 3: `packages/pipelines/tsconfig.json`**

```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "outDir": "dist", "types": ["node"] }, "include": ["src/**/*", "test/**/*"] }
```

- [ ] **Step 4: `packages/pipelines/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { testTimeout: 60_000, hookTimeout: 60_000 } });
```

- [ ] **Step 5: `packages/pipelines/src/migrate.ts`**

```ts
import type { Db } from '@so/sdk';

export async function runMigrations(db: Db): Promise<void> {
  await db.query(`CREATE TABLE IF NOT EXISTS pipelines (
    id text PRIMARY KEY,
    org_id text NOT NULL,
    name text NOT NULL,
    sql text NOT NULL,
    inputs jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (org_id, name)
  )`);
}
```

- [ ] **Step 6: `packages/pipelines/src/service.ts`**

```ts
import { randomUUID } from 'node:crypto';
import type { ModuleContext } from '@so/sdk';

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function guardSql(sql: string): void {
  if (sql.length > 2000) throw new Error('pipeline SQL too long');
  if (sql.includes(';') || sql.includes('--') || sql.includes('/*')) throw new Error('illegal characters in pipeline SQL');
}

export interface PipelineInput { name: string; inputs: string[]; sql: string; }

export function createPipelineService(ctx: ModuleContext) {
  async function createPipeline(orgId: string, input: PipelineInput): Promise<string> {
    if (!NAME_RE.test(input.name)) throw new Error('invalid pipeline name');
    if (!Array.isArray(input.inputs) || input.inputs.length === 0) throw new Error('at least one input dataset name required');
    for (const i of input.inputs) if (!NAME_RE.test(i)) throw new Error(`invalid input dataset name: ${i}`);
    guardSql(input.sql);
    const id = randomUUID();
    await ctx.db.query(
      `INSERT INTO pipelines(id,org_id,name,sql,inputs) VALUES ($1,$2,$3,$4,$5)`,
      [id, orgId, input.name, input.sql, JSON.stringify(input.inputs)],
    );
    return id;
  }

  async function listPipelines(orgId: string): Promise<Array<{ id: string; name: string; inputs: string[] }>> {
    const rows = await ctx.db.query<{ id: string; name: string; inputs: string[] }>(
      `SELECT id, name, inputs FROM pipelines WHERE org_id = $1 ORDER BY name`, [orgId],
    );
    return rows.map((r) => ({ id: r.id, name: r.name, inputs: r.inputs }));
  }

  async function run(orgId: string, pipelineId: string): Promise<{ datasetId: string; rowCount: number }> {
    const p = await ctx.db.query<{ name: string; sql: string; inputs: string[] }>(
      `SELECT name, sql, inputs FROM pipelines WHERE org_id = $1 AND id = $2`, [orgId, pipelineId],
    );
    const pipe = p[0];
    if (!pipe) throw new Error('pipeline not found');
    guardSql(pipe.sql);

    const datasetId = randomUUID();
    const objectKey = `${orgId}/datasets/${datasetId}/data.parquet`;
    const s3url = ctx.objectStore.getObjectUrl(objectKey);
    const session = await ctx.query.open();
    try {
      // create a DuckDB view per input dataset (latest with that name)
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
      await session.all(`CREATE TEMP TABLE _out AS ${pipe.sql}`);
      const described = await session.all(`DESCRIBE _out`);
      const counted = await session.all(`SELECT count(*)::int AS n FROM _out`);
      await session.all(`COPY _out TO '${s3url}' (FORMAT parquet)`);
      const rowCount = Number(counted[0]?.n ?? 0);

      await ctx.db.query(`INSERT INTO datasets(id,org_id,name,object_key,row_count) VALUES ($1,$2,$3,$4,$5)`, [datasetId, orgId, pipe.name, objectKey, rowCount]);
      for (let i = 0; i < described.length; i++) {
        const col = described[i]!;
        await ctx.db.query(`INSERT INTO dataset_columns(dataset_id,ordinal,name,duck_type) VALUES ($1,$2,$3,$4)`, [datasetId, i, String(col.column_name), String(col.column_type)]);
      }
      return { datasetId, rowCount };
    } finally {
      await session.close();
    }
  }

  return { createPipeline, listPipelines, run };
}
```

- [ ] **Step 7: `packages/pipelines/src/routes.ts`**

```ts
import type { FastifyPluginAsync } from 'fastify';
import { requirePermission } from '@so/auth';
import { createPipelineService, type PipelineInput } from './service.js';

export const pipelineRoutes: FastifyPluginAsync = async (fastify) => {
  const svc = createPipelineService(fastify.ctx);

  fastify.post('/', { preHandler: requirePermission('pipelines:write') }, async (req, reply) => {
    const body = req.body as Partial<PipelineInput>;
    if (!body?.name || !Array.isArray(body?.inputs) || !body?.sql) return reply.code(400).send({ error: 'name, inputs[], sql required' });
    try { const id = await svc.createPipeline(req.user!.orgId, body as PipelineInput); return reply.code(201).send({ id }); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  fastify.get('/', { preHandler: requirePermission('pipelines:read') }, async (req) => ({ pipelines: await svc.listPipelines(req.user!.orgId) }));

  fastify.post('/:id/run', { preHandler: requirePermission('pipelines:write') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try { return reply.code(200).send(await svc.run(req.user!.orgId, id)); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });
};
```

- [ ] **Step 8: `packages/pipelines/src/index.ts`**

```ts
import { defineModule } from '@so/sdk';
import { runMigrations } from './migrate.js';
import { pipelineRoutes } from './routes.js';

export default defineModule({
  id: 'pipelines',
  dependsOn: ['datasets', 'auth'],
  contributes: { apiRoutes: pipelineRoutes, permissions: ['pipelines:read', 'pipelines:write'] },
  async onInstall(ctx) { await runMigrations(ctx.db); },
});

export { createPipelineService, type PipelineInput } from './service.js';
```

- [ ] **Step 9: `packages/pipelines/test/pipelines.int.test.ts`**

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

describe('pipeline: SQL transform produces a derived dataset', () => {
  it('filters delayed flights into a new dataset', async () => {
    server = await createServer({ modules: [authModule, datasetsModule, pipelinesModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();
    await server.kernel.ctx.db.query(`DELETE FROM pipelines WHERE name='delayedout'`);

    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const auth = { cookie: cookieFrom(login.headers['set-cookie']) };

    await server.app.inject({ method: 'POST', url: '/api/datasets?name=flightspipe&format=csv', headers: { ...auth, 'content-type': 'text/csv' }, payload: 'flight_no,status,seats\nFL-204,Delayed,189\nFL-118,Boarding,142\nFL-552,Delayed,200\n' });

    const create = await server.app.inject({ method: 'POST', url: '/api/pipelines', headers: auth, payload: { name: 'delayedout', inputs: ['flightspipe'], sql: "SELECT flight_no, seats FROM flightspipe WHERE status = 'Delayed'" } });
    expect(create.statusCode).toBe(201);
    const pid = create.json().id as string;

    const run = await server.app.inject({ method: 'POST', url: `/api/pipelines/${pid}/run`, headers: auth });
    expect(run.statusCode).toBe(200);
    expect(run.json().rowCount).toBe(2);

    const preview = await server.app.inject({ method: 'GET', url: `/api/datasets/${run.json().datasetId}/preview`, headers: auth });
    const rows = preview.json().rows as Array<{ flight_no: string }>;
    expect(rows.map((r) => r.flight_no).sort()).toEqual(['FL-204', 'FL-552']);
  });
});
```

- [ ] **Step 10: Run with infra up → PASS:** `pnpm run infra:up && pnpm --filter @so/pipelines test` (timeout 180000). Then `pnpm --filter @so/pipelines run typecheck` clean. Ensure NO unused imports (eslint fails on them).

- [ ] **Step 11: Commit**

```bash
git add -A && git commit -m "feat(pipelines): SQL transforms producing derived datasets"
```

---

## Task 2: Full verification + merge

- [ ] **Step 1:** `pnpm run infra:up && pnpm run infra:seed && pnpm typecheck && pnpm lint && pnpm test` → all green, no regressions.
- [ ] **Step 2:** `git checkout main && git merge --ff-only phase12/module-pipelines`

---

## Self-review
- **Spec §6 (pipelines/transforms)** — SQL transforms over datasets producing derived datasets, registered + immediately modelable. ✓
- **Additive / self-contained** — new package; no merged code modified. ✓
- **Security** — admin-gated (`pipelines:write`); name/input identifiers validated; SQL guarded (single statement, no comments, length cap); inputs exposed as read-only DuckDB views over Parquet. ✓
- **Deferred:** pipeline DAGs / multi-step, scheduling + incremental builds, dependency tracking between pipelines (→ lineage, next), the shared `ingestRelation` DRY refactor. Flagged.
