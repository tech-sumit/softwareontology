# Phase 5 — module-datasets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `@so/datasets` — upload a CSV/Parquet file, convert + store it as Parquet in object storage, register it (dataset + columns) in Postgres, and preview rows via DuckDB. Plus the cross-module **auth enforcement** deferred from Plan 4: root cookie parsing in the server and a `requirePermission` preHandler in `@so/auth`, used to protect the dataset routes.

**Architecture:** `@so/server` registers `@fastify/cookie` at the root so every route can read the session cookie. `@so/auth` exports `requirePermission(perm)` — a Fastify preHandler that validates the session and checks a permission, attaching `request.user`. `@so/datasets` (dependsOn `auth`) ingests uploads through DuckDB straight to `s3://` Parquet (no manual byte shuffling), records metadata, and serves protected `/api/datasets` routes.

**Tech Stack:** TypeScript, DuckDB (via `ctx.query`) for CSV→Parquet ingestion + preview, `ctx.objectStore` for the S3 URL, `ctx.db` for the registry, `@fastify/cookie`, consuming `@so/sdk`/`@so/auth`; integration-tested via `@so/server` against Docker Postgres + MinIO.

---

## Pre-flight

- [ ] **Branch:** `cd /Users/sumitagrawal/CODE/sumit/SoftwareOntology && git checkout main && git checkout -b phase5/module-datasets`

---

## File structure

```
packages/server/        (modified) register @fastify/cookie at root; +dep
packages/auth/          (modified) requirePermission preHandler + FastifyRequest.user; routes.ts drops its local cookie register
packages/datasets/      (new) @so/datasets
  package.json          dep: @so/sdk @so/auth fastify ; devDep: @so/server @so/observability @types/node @types/pg
  tsconfig.json
  vitest.config.ts
  src/migrate.ts        runMigrations(db) — datasets + dataset_columns
  src/service.ts        createDatasetService(ctx): ingest/list/get/preview
  src/routes.ts         datasetRoutes (protected) + text/csv body parser
  src/index.ts          defineModule({ id:'datasets', dependsOn:['auth'], ... })
  test/datasets.int.test.ts
```

---

## Task 1: `@so/server` — root cookie parsing

**Files:** Modify `packages/server/package.json`, `packages/server/src/server.ts`

- [ ] **Step 1: Add the dep — `packages/server/package.json`**

Add `"@fastify/cookie": "^11.0.2"` to `dependencies`, then run `pnpm install`.

- [ ] **Step 2: Register it at root — modify `packages/server/src/server.ts`**

Add the import near the top (with the other imports):
```ts
import cookie from '@fastify/cookie';
```
Immediately after `const app = Fastify({ logger: false });` and before `app.decorate(...)`, add:
```ts
  await app.register(cookie);
```

- [ ] **Step 3: Verify existing server tests still pass (infra up)**

```bash
pnpm run infra:up
pnpm --filter @so/server test
```
Expected: the existing 4 tests still pass (health, readyz, ping route, services). Then `pnpm --filter @so/server run typecheck` (clean).

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(server): register @fastify/cookie at root for cross-module auth"
```

---

## Task 2: `@so/auth` — `requirePermission` preHandler

**Files:** Modify `packages/auth/src/routes.ts`, `packages/auth/src/index.ts`; Create `packages/auth/src/guard.ts`

- [ ] **Step 1: Drop the now-duplicate local cookie registration — modify `packages/auth/src/routes.ts`**

Remove the line `await fastify.register(cookie);` and the `import cookie from '@fastify/cookie';` import. (Cookie parsing is now provided at the server root by Task 1; registering it again in an encapsulated child throws a decorate-already-present error.) Leave everything else in `routes.ts` unchanged.

- [ ] **Step 2: Create `packages/auth/src/guard.ts`**

```ts
import type { preHandlerHookHandler } from 'fastify';
import { createAuthService, hasPermission, type AuthUser } from './service.js';
import { SESSION_COOKIE } from './routes.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

/** Fastify preHandler: require a valid session AND the given permission. */
export function requirePermission(permission: string): preHandlerHookHandler {
  return async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) return reply.code(401).send({ error: 'unauthenticated' });
    const auth = createAuthService(req.server.ctx.db);
    const user = await auth.validateSession(token);
    if (!user) return reply.code(401).send({ error: 'unauthenticated' });
    if (!hasPermission(user.permissions, permission)) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    req.user = user;
  };
}
```

- [ ] **Step 3: Export it — modify `packages/auth/src/index.ts`**

Add:
```ts
export { requirePermission } from './guard.js';
```

- [ ] **Step 4: Verify auth tests still pass (cookie now from root)**

The auth integration test boots `createServer`, which now registers cookie at root, so `/api/auth/*` still parse cookies.
```bash
pnpm --filter @so/auth test
```
Expected: 6 tests still pass. Then `pnpm --filter @so/auth run typecheck` (clean).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(auth): requirePermission preHandler + request.user; cookie now root-provided"
```

---

## Task 3: `@so/datasets` — package, migrations, ingestion service

**Files:** Create `packages/datasets/{package.json,tsconfig.json,vitest.config.ts,src/migrate.ts,src/service.ts}`

- [ ] **Step 1: Create `packages/datasets/package.json`**

```json
{
  "name": "@so/datasets",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "dependencies": {
    "@so/sdk": "workspace:*",
    "@so/auth": "workspace:*",
    "fastify": "^5.2.0"
  },
  "devDependencies": {
    "@so/server": "workspace:*",
    "@so/observability": "workspace:*",
    "@types/node": "^22.10.0",
    "@types/pg": "^8.11.0"
  }
}
```

- [ ] **Step 2: `pnpm install`**

- [ ] **Step 3: Create `packages/datasets/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "types": ["node"] },
  "include": ["src/**/*", "test/**/*"]
}
```

- [ ] **Step 4: Create `packages/datasets/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { testTimeout: 60_000, hookTimeout: 60_000 } });
```

- [ ] **Step 5: Create `packages/datasets/src/migrate.ts`**

```ts
import type { Db } from '@so/sdk';

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS datasets (
     id text PRIMARY KEY,
     org_id text NOT NULL,
     name text NOT NULL,
     object_key text NOT NULL,
     row_count int NOT NULL DEFAULT 0,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS dataset_columns (
     dataset_id text NOT NULL REFERENCES datasets(id),
     ordinal int NOT NULL,
     name text NOT NULL,
     duck_type text NOT NULL,
     PRIMARY KEY (dataset_id, ordinal)
   )`,
];

export async function runMigrations(db: Db): Promise<void> {
  for (const sql of MIGRATIONS) await db.query(sql);
}
```

- [ ] **Step 6: Create `packages/datasets/src/service.ts`**

```ts
import { randomUUID } from 'node:crypto';
import { writeFile, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModuleContext } from '@so/sdk';

export interface DatasetColumn { name: string; duckType: string; }
export interface DatasetMeta {
  id: string;
  name: string;
  objectKey: string;
  rowCount: number;
  columns: DatasetColumn[];
}

export function createDatasetService(ctx: ModuleContext) {
  async function ingest(
    orgId: string,
    name: string,
    format: 'csv' | 'parquet',
    bytes: Buffer,
  ): Promise<DatasetMeta> {
    const id = randomUUID();
    const objectKey = `${orgId}/datasets/${id}/data.parquet`;
    const s3url = ctx.objectStore.getObjectUrl(objectKey);
    const dir = await mkdtemp(join(tmpdir(), 'so-ingest-'));
    const tmpFile = join(dir, format === 'csv' ? 'in.csv' : 'in.parquet');
    await writeFile(tmpFile, bytes);
    const session = await ctx.query.open();
    try {
      const reader = format === 'csv' ? `read_csv_auto('${tmpFile}')` : `read_parquet('${tmpFile}')`;
      await session.all(`CREATE TEMP TABLE _ingest AS SELECT * FROM ${reader}`);
      const described = await session.all(`DESCRIBE _ingest`);
      const counted = await session.all(`SELECT count(*)::int AS n FROM _ingest`);
      await session.all(`COPY _ingest TO '${s3url}' (FORMAT parquet)`);

      const columns: DatasetColumn[] = described.map((c) => ({
        name: String(c.column_name),
        duckType: String(c.column_type),
      }));
      const rowCount = Number(counted[0]?.n ?? 0);

      await ctx.db.query(
        `INSERT INTO datasets(id,org_id,name,object_key,row_count) VALUES ($1,$2,$3,$4,$5)`,
        [id, orgId, name, objectKey, rowCount],
      );
      for (let i = 0; i < columns.length; i++) {
        const col = columns[i]!;
        await ctx.db.query(
          `INSERT INTO dataset_columns(dataset_id,ordinal,name,duck_type) VALUES ($1,$2,$3,$4)`,
          [id, i, col.name, col.duckType],
        );
      }
      return { id, name, objectKey, rowCount, columns };
    } finally {
      await session.close();
      await rm(dir, { recursive: true, force: true });
    }
  }

  async function list(orgId: string): Promise<DatasetMeta[]> {
    const rows = await ctx.db.query<{ id: string; name: string; object_key: string; row_count: number }>(
      `SELECT id, name, object_key, row_count FROM datasets WHERE org_id = $1 ORDER BY created_at DESC`,
      [orgId],
    );
    const out: DatasetMeta[] = [];
    for (const r of rows) out.push({ id: r.id, name: r.name, objectKey: r.object_key, rowCount: r.row_count, columns: await columnsFor(r.id) });
    return out;
  }

  async function get(orgId: string, id: string): Promise<DatasetMeta | null> {
    const rows = await ctx.db.query<{ id: string; name: string; object_key: string; row_count: number }>(
      `SELECT id, name, object_key, row_count FROM datasets WHERE org_id = $1 AND id = $2`,
      [orgId, id],
    );
    const r = rows[0];
    if (!r) return null;
    return { id: r.id, name: r.name, objectKey: r.object_key, rowCount: r.row_count, columns: await columnsFor(r.id) };
  }

  async function columnsFor(datasetId: string): Promise<DatasetColumn[]> {
    const rows = await ctx.db.query<{ name: string; duck_type: string }>(
      `SELECT name, duck_type FROM dataset_columns WHERE dataset_id = $1 ORDER BY ordinal`,
      [datasetId],
    );
    return rows.map((r) => ({ name: r.name, duckType: r.duck_type }));
  }

  async function preview(objectKey: string, limit = 50, offset = 0): Promise<Record<string, unknown>[]> {
    const s3url = ctx.objectStore.getObjectUrl(objectKey);
    const session = await ctx.query.open();
    try {
      const lim = Number.isInteger(limit) ? limit : 50;
      const off = Number.isInteger(offset) ? offset : 0;
      return await session.all(`SELECT * FROM read_parquet('${s3url}') LIMIT ${lim} OFFSET ${off}`);
    } finally {
      await session.close();
    }
  }

  return { ingest, list, get, preview };
}
```

- [ ] **Step 7: Typecheck + commit**

```bash
pnpm --filter @so/datasets run typecheck
git add -A && git commit -m "feat(datasets): package + migrations + DuckDB ingestion/preview service"
```

---

## Task 4: `@so/datasets` — protected routes + module + integration test

**Files:** Create `packages/datasets/src/routes.ts`, `packages/datasets/src/index.ts`, `packages/datasets/test/datasets.int.test.ts`

- [ ] **Step 1: Create `packages/datasets/src/routes.ts`**

```ts
import type { FastifyPluginAsync } from 'fastify';
import { requirePermission } from '@so/auth';
import { createDatasetService } from './service.js';

export const datasetRoutes: FastifyPluginAsync = async (fastify) => {
  // Accept raw file bodies for upload.
  fastify.addContentTypeParser(
    ['text/csv', 'application/octet-stream'],
    { parseAs: 'buffer' },
    (_req, body, done) => done(null, body),
  );

  const svc = createDatasetService(fastify.ctx);

  fastify.post('/', { preHandler: requirePermission('datasets:write') }, async (req, reply) => {
    const q = req.query as { name?: string; format?: string };
    if (!q.name) return reply.code(400).send({ error: 'name query param required' });
    const format = q.format === 'parquet' ? 'parquet' : 'csv';
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      return reply.code(400).send({ error: 'empty upload body' });
    }
    const orgId = req.user!.orgId;
    const dataset = await svc.ingest(orgId, q.name, format, body);
    return reply.code(201).send({ dataset });
  });

  fastify.get('/', { preHandler: requirePermission('datasets:read') }, async (req) => {
    return { datasets: await svc.list(req.user!.orgId) };
  });

  fastify.get('/:id', { preHandler: requirePermission('datasets:read') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const ds = await svc.get(req.user!.orgId, id);
    if (!ds) return reply.code(404).send({ error: 'not found' });
    return { dataset: ds };
  });

  fastify.get('/:id/preview', { preHandler: requirePermission('datasets:read') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as { limit?: string; offset?: string };
    const ds = await svc.get(req.user!.orgId, id);
    if (!ds) return reply.code(404).send({ error: 'not found' });
    const rows = await svc.preview(ds.objectKey, Number(q.limit ?? 50), Number(q.offset ?? 0));
    return { rows };
  });
};
```

- [ ] **Step 2: Create `packages/datasets/src/index.ts`**

```ts
import { defineModule } from '@so/sdk';
import { runMigrations } from './migrate.js';
import { datasetRoutes } from './routes.js';

export default defineModule({
  id: 'datasets',
  dependsOn: ['auth'],
  contributes: {
    apiRoutes: datasetRoutes,
    permissions: ['datasets:read', 'datasets:write'],
  },
  async onInstall(ctx) {
    await runMigrations(ctx.db);
  },
});

export { createDatasetService, type DatasetMeta, type DatasetColumn } from './service.js';
```

- [ ] **Step 3: Create `packages/datasets/test/datasets.int.test.ts`**

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { createServer, createConfig, type AppServer } from '@so/server';
import { createLogger } from '@so/observability';
import authModule from '@so/auth';
import datasetsModule from '../src/index.js';
import { SESSION_COOKIE } from '@so/auth';

const config = createConfig({
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so',
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'localhost:9000',
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin',
  S3_BUCKET: process.env.S3_BUCKET ?? 'so-datasets',
  ADMIN_EMAIL: 'admin@example.com',
  ADMIN_PASSWORD: 'admin',
});

let server: AppServer;
afterAll(async () => { await server?.stop(); });

function cookieFrom(setCookie: string | string[] | undefined): string {
  const raw = Array.isArray(setCookie) ? setCookie[0]! : setCookie!;
  return raw.split(';')[0]!;
}

describe('dataset routes', () => {
  it('rejects unauthenticated access', async () => {
    server = await createServer({ modules: [authModule, datasetsModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();
    const res = await server.app.inject({ method: 'GET', url: '/api/datasets' });
    expect(res.statusCode).toBe(401);
  });

  it('uploads a CSV, lists it, and previews rows', async () => {
    const login = await server.app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { email: 'admin@example.com', password: 'admin' },
    });
    const cookie = cookieFrom(login.headers['set-cookie']);

    const upload = await server.app.inject({
      method: 'POST', url: '/api/datasets?name=flights&format=csv',
      headers: { cookie, 'content-type': 'text/csv' },
      payload: 'flight_no,status\nFL-204,Delayed\nFL-118,Boarding\nFL-552,On time\n',
    });
    expect(upload.statusCode).toBe(201);
    const dsId = upload.json().dataset.id as string;
    expect(upload.json().dataset.rowCount).toBe(3);
    expect(upload.json().dataset.columns.map((c: { name: string }) => c.name)).toEqual(['flight_no', 'status']);

    const list = await server.app.inject({ method: 'GET', url: '/api/datasets', headers: { cookie } });
    expect(list.statusCode).toBe(200);
    expect(list.json().datasets.some((d: { id: string }) => d.id === dsId)).toBe(true);

    const preview = await server.app.inject({ method: 'GET', url: `/api/datasets/${dsId}/preview`, headers: { cookie } });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().rows).toHaveLength(3);
    expect(preview.json().rows[0].flight_no).toBe('FL-204');
  });
});
```

- [ ] **Step 4: Run with infra up → PASS**

```bash
pnpm run infra:up
pnpm --filter @so/datasets test
```
Expected: 2 tests pass (unauth 401; upload→list→preview). (Bash timeout 180000.) Then `pnpm --filter @so/datasets run typecheck` (clean).

> If `req.body` is not a Buffer, confirm the `addContentTypeParser` covers the request's content-type. If the DuckDB `COPY ... TO 's3://...'` fails, confirm `ctx.query.open()` configured S3 (it does, from env) and the bucket exists (`pnpm run infra:up` creates it).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(datasets): protected upload/list/get/preview routes + module wiring"
```

---

## Task 5: Full verification + merge

- [ ] **Step 1: Full suite**

```bash
pnpm run infra:up && pnpm run infra:seed
pnpm typecheck && pnpm lint && pnpm test
```
Expected: typecheck + lint clean; **41 tests** (prior 37 + datasets 2 + the unchanged auth/server counts; note server/auth test counts are unchanged at 4/6).

- [ ] **Step 2: Merge**

```bash
git checkout main && git merge --ff-only phase5/module-datasets
```

---

## Done criteria

- `@so/server` parses cookies at the root; `@so/auth` exposes `requirePermission` and the dataset routes are protected (401 unauthenticated, 403 without permission, 200 for admin `*`).
- `POST /api/datasets` ingests a CSV through DuckDB to Parquet in MinIO and registers it; `GET /api/datasets`, `/:id`, `/:id/preview` work.
- Full suite green.

Plan 6 (`module-ontology`) maps these datasets to Object Types/Properties/Links and wires `@so/query`'s `resolveObjectSet` (built in Plan 1) behind ontology routes.

---

## Self-review (against the spec)

- **Spec §6 (module-datasets)** — upload connector (CSV/Parquet), dataset registry + schema, DuckDB-backed preview, Parquet in object storage. ✓
- **Spec §6/§8 (auth enforcement)** — the deferred cross-module `requirePermission` + root cookie land here, protecting the first real module routes; `request.user` carries `orgId` for org-scoping every query. ✓
- **Spec §7 (object storage path)** — ingestion writes Parquet straight to `s3://` via DuckDB; preview reads it back — same engine the ontology resolver uses. ✓
- **Placeholder scan** — complete code; the body-parser/COPY notes are diagnostics, not placeholders. ✓
- **Type consistency** — `DatasetMeta`/`DatasetColumn`/`createDatasetService` defined once; `requirePermission`/`SESSION_COOKIE`/`AuthUser` imported from `@so/auth`; `req.user!.orgId` relies on the `FastifyRequest.user` augmentation in `guard.ts`; routes use `fastify.ctx` (Plan 3). ✓
- **Deliberately deferred:** multipart upload (raw-body CSV/Parquet now; multipart later), large-file streaming, dataset versioning/branches (Phase 2 roadmap), per-column type mapping to ontology PropTypes (Plan 6). Flagged, not silent.
```
