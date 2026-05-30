# Phase 11 (2.2) — module-connectors-db Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** Ingest an external Postgres table into a dataset. A connector stores a source connection + table; "sync" uses DuckDB to `ATTACH` the source (read-only), `COPY` the table to Parquet in object storage, and register it as a dataset (same shape datasets ingest produces) — so it's immediately modelable as an ontology object type.

**Architecture:** New `@so/connectors-db` (dependsOn `datasets`, `auth`). Self-contained: it opens a `ctx.query` DuckDB session (already S3-configured), `ATTACH`es the source Postgres, COPYs `SELECT * FROM src.<table>` to `s3://`, then registers the dataset via `ctx.db` (the stable `datasets`/`dataset_columns` schema). Sync is synchronous via a route (scheduled-job sync deferred). Routes are auth-protected.

> **Security note (deferred):** the source connection string (with credentials) is stored as-is and interpolated into `ATTACH` — acceptable for an admin-gated Phase-2 feature; encrypted secrets + parameterized ATTACH are Phase-2-hardening.

---

## Pre-flight
- [ ] **Branch:** `git checkout main && git checkout -b phase11/module-connectors-db`

---

## Task 1: `@so/connectors-db` (package + migration + service + routes + module + test)

**Files:** Create `packages/connectors-db/{package.json,tsconfig.json,vitest.config.ts,src/migrate.ts,src/service.ts,src/routes.ts,src/index.ts,test/connectors.int.test.ts}`

- [ ] **Step 1: `packages/connectors-db/package.json`**

```json
{
  "name": "@so/connectors-db",
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

- [ ] **Step 3: `packages/connectors-db/tsconfig.json`**

```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "outDir": "dist", "types": ["node"] }, "include": ["src/**/*", "test/**/*"] }
```

- [ ] **Step 4: `packages/connectors-db/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { testTimeout: 60_000, hookTimeout: 60_000 } });
```

- [ ] **Step 5: `packages/connectors-db/src/migrate.ts`**

```ts
import type { Db } from '@so/sdk';

export async function runMigrations(db: Db): Promise<void> {
  await db.query(`CREATE TABLE IF NOT EXISTS db_connectors (
    id text PRIMARY KEY,
    org_id text NOT NULL,
    name text NOT NULL,
    source_conn_string text NOT NULL,
    source_table text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (org_id, name)
  )`);
}
```

- [ ] **Step 6: `packages/connectors-db/src/service.ts`**

```ts
import { randomUUID } from 'node:crypto';
import type { ModuleContext } from '@so/sdk';

const NAME_RE = /^[A-Za-z0-9_-]+$/;
const TABLE_RE = /^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/;

export interface ConnectorInput { name: string; sourceConnString: string; sourceTable: string; }

export function createConnectorService(ctx: ModuleContext) {
  async function createConnector(orgId: string, input: ConnectorInput): Promise<string> {
    if (!NAME_RE.test(input.name)) throw new Error('invalid connector name');
    if (!TABLE_RE.test(input.sourceTable)) throw new Error('sourceTable must be schema.table');
    if (!input.sourceConnString) throw new Error('sourceConnString required');
    const id = randomUUID();
    await ctx.db.query(
      `INSERT INTO db_connectors(id,org_id,name,source_conn_string,source_table) VALUES ($1,$2,$3,$4,$5)`,
      [id, orgId, input.name, input.sourceConnString, input.sourceTable],
    );
    return id;
  }

  async function listConnectors(orgId: string): Promise<Array<{ id: string; name: string; sourceTable: string }>> {
    const rows = await ctx.db.query<{ id: string; name: string; source_table: string }>(
      `SELECT id, name, source_table FROM db_connectors WHERE org_id = $1 ORDER BY name`, [orgId],
    );
    return rows.map((r) => ({ id: r.id, name: r.name, sourceTable: r.source_table }));
  }

  async function sync(orgId: string, connectorId: string): Promise<{ datasetId: string; rowCount: number }> {
    const c = await ctx.db.query<{ name: string; source_conn_string: string; source_table: string }>(
      `SELECT name, source_conn_string, source_table FROM db_connectors WHERE org_id = $1 AND id = $2`, [orgId, connectorId],
    );
    const conn = c[0];
    if (!conn) throw new Error('connector not found');
    if (!TABLE_RE.test(conn.source_table)) throw new Error('invalid source table');

    const datasetId = randomUUID();
    const objectKey = `${orgId}/datasets/${datasetId}/data.parquet`;
    const s3url = ctx.objectStore.getObjectUrl(objectKey);
    const session = await ctx.query.open();
    try {
      await session.all(`ATTACH '${conn.source_conn_string}' AS src (TYPE postgres, READ_ONLY)`);
      await session.all(`CREATE TEMP TABLE _ingest AS SELECT * FROM src.${conn.source_table}`);
      const described = await session.all(`DESCRIBE _ingest`);
      const counted = await session.all(`SELECT count(*)::int AS n FROM _ingest`);
      await session.all(`COPY _ingest TO '${s3url}' (FORMAT parquet)`);
      const rowCount = Number(counted[0]?.n ?? 0);

      await ctx.db.query(
        `INSERT INTO datasets(id,org_id,name,object_key,row_count) VALUES ($1,$2,$3,$4,$5)`,
        [datasetId, orgId, conn.name, objectKey, rowCount],
      );
      for (let i = 0; i < described.length; i++) {
        const col = described[i]!;
        await ctx.db.query(
          `INSERT INTO dataset_columns(dataset_id,ordinal,name,duck_type) VALUES ($1,$2,$3,$4)`,
          [datasetId, i, String(col.column_name), String(col.column_type)],
        );
      }
      return { datasetId, rowCount };
    } finally {
      await session.close();
    }
  }

  return { createConnector, listConnectors, sync };
}
```

- [ ] **Step 7: `packages/connectors-db/src/routes.ts`**

```ts
import type { FastifyPluginAsync } from 'fastify';
import { requirePermission } from '@so/auth';
import { createConnectorService, type ConnectorInput } from './service.js';

export const connectorRoutes: FastifyPluginAsync = async (fastify) => {
  const svc = createConnectorService(fastify.ctx);

  fastify.post('/', { preHandler: requirePermission('connectors:write') }, async (req, reply) => {
    const body = req.body as Partial<ConnectorInput>;
    if (!body?.name || !body?.sourceConnString || !body?.sourceTable) return reply.code(400).send({ error: 'name, sourceConnString, sourceTable required' });
    try { const id = await svc.createConnector(req.user!.orgId, body as ConnectorInput); return reply.code(201).send({ id }); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  fastify.get('/', { preHandler: requirePermission('connectors:read') }, async (req) => ({ connectors: await svc.listConnectors(req.user!.orgId) }));

  fastify.post('/:id/sync', { preHandler: requirePermission('connectors:write') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try { return reply.code(200).send(await svc.sync(req.user!.orgId, id)); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });
};
```

- [ ] **Step 8: `packages/connectors-db/src/index.ts`**

```ts
import { defineModule } from '@so/sdk';
import { runMigrations } from './migrate.js';
import { connectorRoutes } from './routes.js';

export default defineModule({
  id: 'connectors-db',
  dependsOn: ['datasets', 'auth'],
  contributes: { apiRoutes: connectorRoutes, permissions: ['connectors:read', 'connectors:write'] },
  async onInstall(ctx) { await runMigrations(ctx.db); },
});

export { createConnectorService, type ConnectorInput } from './service.js';
```

- [ ] **Step 9: `packages/connectors-db/test/connectors.int.test.ts`**

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { createServer, createConfig, type AppServer } from '@so/server';
import { createLogger } from '@so/observability';
import authModule from '@so/auth';
import datasetsModule from '@so/datasets';
import connectorsModule from '../src/index.js';

const PG = process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so';
const config = createConfig({
  DATABASE_URL: PG, S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'localhost:9000',
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin', S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin',
  S3_BUCKET: process.env.S3_BUCKET ?? 'so-datasets', ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: 'admin',
});

let server: AppServer;
afterAll(async () => { await server?.stop(); });
function cookieFrom(s: string | string[] | undefined): string { const raw = Array.isArray(s) ? s[0]! : s!; return raw.split(';')[0]!; }

describe('db connector: ingest an external Postgres table into a dataset', () => {
  it('creates a connector, syncs, and the dataset is queryable', async () => {
    server = await createServer({ modules: [authModule, datasetsModule, connectorsModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();
    const db = server.kernel.ctx.db;

    // a "source" table in the same Postgres + isolation
    await db.query(`DELETE FROM db_connectors WHERE name='extconn'`);
    await db.query(`DROP TABLE IF EXISTS ext_src`);
    await db.query(`CREATE TABLE ext_src (id int, label text)`);
    await db.query(`INSERT INTO ext_src(id,label) VALUES (1,'alpha'),(2,'beta'),(3,'gamma')`);

    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const auth = { cookie: cookieFrom(login.headers['set-cookie']) };

    const create = await server.app.inject({ method: 'POST', url: '/api/connectors-db', headers: auth, payload: { name: 'extconn', sourceConnString: PG, sourceTable: 'public.ext_src' } });
    expect(create.statusCode).toBe(201);
    const connId = create.json().id as string;

    const sync = await server.app.inject({ method: 'POST', url: `/api/connectors-db/${connId}/sync`, headers: auth });
    expect(sync.statusCode).toBe(200);
    expect(sync.json().rowCount).toBe(3);
    const datasetId = sync.json().datasetId as string;

    const preview = await server.app.inject({ method: 'GET', url: `/api/datasets/${datasetId}/preview`, headers: auth });
    expect(preview.statusCode).toBe(200);
    const rows = preview.json().rows as Array<{ id: number; label: string }>;
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.label).sort()).toEqual(['alpha', 'beta', 'gamma']);
  });
});
```

- [ ] **Step 10: Run with infra up → PASS:** `pnpm run infra:up && pnpm --filter @so/connectors-db test` (Bash timeout 180000). Then `pnpm --filter @so/connectors-db run typecheck` clean. (Note: `id`/`label` come back as JS numbers/strings; `id` int → may be number or bigint — the test uses `.label` for the value check and `.toHaveLength(3)`, avoiding int-marshalling assumptions.)

- [ ] **Step 11: Commit**

```bash
git add -A && git commit -m "feat(connectors-db): ingest an external Postgres table into a dataset"
```

---

## Task 2: Full verification + merge

- [ ] **Step 1:** `pnpm run infra:up && pnpm run infra:seed && pnpm typecheck && pnpm lint && pnpm test` → all green, confirm new total, no regressions.
- [ ] **Step 2:** `git checkout main && git merge --ff-only phase11/module-connectors-db`

---

## Self-review
- **Spec §6 (connectors)** — a real source connector (external Postgres → Parquet → dataset registry), reusing the DuckDB ingestion path. ✓
- **Additive** — new package; no merged code modified; uses the stable `datasets`/`dataset_columns` schema via `ctx.db`. ✓
- **Security** — admin-gated (`connectors:write`); name/table validated; conn-string storage flagged for Phase-2 secrets hardening. ✓
- **Deferred:** scheduled/incremental sync via pg-boss job (worker), encrypted secrets, non-Postgres sources (MySQL/REST), column-type coercion. Flagged.
