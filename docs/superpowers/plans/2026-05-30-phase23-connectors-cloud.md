# Phase 23 (#2.2) — S3 + REST Connectors Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps `- [ ]`.

**Goal:** Two native connectors — **S3 file** (read a CSV/Parquet object from object storage → dataset) and **REST/JSON** (fetch a JSON array from an HTTP endpoint → dataset) — both via DuckDB, registering datasets the same way.

**Architecture:** New `@so/connectors-cloud` (dependsOn `datasets`, `auth`), self-contained (writes the `datasets`/`dataset_columns` schema). A `cloud_connectors` table with `kind` (`s3`|`rest`) + `config jsonb`; `sync` dispatches by kind.

---

## Pre-flight
- [ ] **Branch:** `git checkout main && git checkout -b phase23/connectors-cloud`

---

## Task 1: `@so/connectors-cloud`

**Files:** Create `packages/connectors-cloud/{package.json,tsconfig.json,vitest.config.ts,src/migrate.ts,src/service.ts,src/routes.ts,src/index.ts,test/connectors-cloud.int.test.ts}`

- [ ] **Step 1: `packages/connectors-cloud/package.json`**
```json
{
  "name": "@so/connectors-cloud", "version": "0.0.0", "private": true, "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "dependencies": { "@so/sdk": "workspace:*", "@so/auth": "workspace:*", "fastify": "^5.2.0" },
  "devDependencies": { "@so/server": "workspace:*", "@so/observability": "workspace:*", "@so/datasets": "workspace:*", "@types/node": "^22.10.0", "@types/pg": "^8.11.0" }
}
```

- [ ] **Step 2: `pnpm install`**

- [ ] **Step 3: `packages/connectors-cloud/tsconfig.json`**
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "outDir": "dist", "types": ["node"] }, "include": ["src/**/*", "test/**/*"] }
```

- [ ] **Step 4: `packages/connectors-cloud/vitest.config.ts`**
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { testTimeout: 60_000, hookTimeout: 60_000 } });
```

- [ ] **Step 5: `packages/connectors-cloud/src/migrate.ts`**
```ts
import type { Db } from '@so/sdk';
export async function runMigrations(db: Db): Promise<void> {
  await db.query(`CREATE TABLE IF NOT EXISTS cloud_connectors (
    id text PRIMARY KEY, org_id text NOT NULL, name text NOT NULL,
    kind text NOT NULL, config jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (org_id, name)
  )`);
}
```

- [ ] **Step 6: `packages/connectors-cloud/src/service.ts`**
```ts
import { randomUUID } from 'node:crypto';
import { writeFile, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModuleContext } from '@so/sdk';

const NAME_RE = /^[A-Za-z0-9_-]+$/;

export interface CloudConnectorInput { name: string; kind: 's3' | 'rest'; config: Record<string, unknown>; }

export function createCloudConnectorService(ctx: ModuleContext) {
  async function createConnector(orgId: string, input: CloudConnectorInput): Promise<string> {
    if (!NAME_RE.test(input.name)) throw new Error('invalid connector name');
    if (input.kind !== 's3' && input.kind !== 'rest') throw new Error('kind must be s3|rest');
    const id = randomUUID();
    await ctx.db.query(`INSERT INTO cloud_connectors(id,org_id,name,kind,config) VALUES ($1,$2,$3,$4,$5)`, [id, orgId, input.name, input.kind, JSON.stringify(input.config ?? {})]);
    return id;
  }

  async function listConnectors(orgId: string): Promise<Array<{ id: string; name: string; kind: string }>> {
    const rows = await ctx.db.query<{ id: string; name: string; kind: string }>(`SELECT id, name, kind FROM cloud_connectors WHERE org_id = $1 ORDER BY name`, [orgId]);
    return rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind }));
  }

  async function register(orgId: string, name: string, session: { all(sql: string, ...p: unknown[]): Promise<Record<string, unknown>[]> }): Promise<{ datasetId: string; rowCount: number }> {
    const datasetId = randomUUID();
    const objectKey = `${orgId}/datasets/${datasetId}/data.parquet`;
    const s3out = ctx.objectStore.getObjectUrl(objectKey);
    const described = await session.all(`DESCRIBE _ingest`);
    const counted = await session.all(`SELECT count(*)::int AS n FROM _ingest`);
    await session.all(`COPY _ingest TO '${s3out}' (FORMAT parquet)`);
    const rowCount = Number(counted[0]?.n ?? 0);
    await ctx.db.query(`INSERT INTO datasets(id,org_id,name,object_key,row_count) VALUES ($1,$2,$3,$4,$5)`, [datasetId, orgId, name, objectKey, rowCount]);
    for (let i = 0; i < described.length; i++) { const c = described[i]!; await ctx.db.query(`INSERT INTO dataset_columns(dataset_id,ordinal,name,duck_type) VALUES ($1,$2,$3,$4)`, [datasetId, i, String(c.column_name), String(c.column_type)]); }
    return { datasetId, rowCount };
  }

  async function sync(orgId: string, id: string): Promise<{ datasetId: string; rowCount: number }> {
    const rows = await ctx.db.query<{ name: string; kind: string; config: Record<string, unknown> }>(`SELECT name, kind, config FROM cloud_connectors WHERE org_id = $1 AND id = $2`, [orgId, id]);
    const conn = rows[0];
    if (!conn) throw new Error('connector not found');

    if (conn.kind === 's3') {
      const s3Url = String(conn.config.s3Url ?? '');
      const format = conn.config.format === 'parquet' ? 'parquet' : 'csv';
      if (!s3Url.startsWith('s3://')) throw new Error('config.s3Url must be an s3:// URL');
      const session = await ctx.query.open();
      try {
        const reader = format === 'parquet' ? `read_parquet('${s3Url}')` : `read_csv_auto('${s3Url}')`;
        await session.all(`CREATE TEMP TABLE _ingest AS SELECT * FROM ${reader}`);
        return await register(orgId, conn.name, session);
      } finally { await session.close(); }
    }

    // rest
    const url = String(conn.config.url ?? '');
    if (!/^https?:\/\//.test(url)) throw new Error('config.url must be an http(s) URL');
    const arrayPath = conn.config.arrayPath ? String(conn.config.arrayPath) : undefined;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`REST source error: ${res.status}`);
    const data = (await res.json()) as unknown;
    const arr = arrayPath ? (data as Record<string, unknown>)[arrayPath] : data;
    if (!Array.isArray(arr)) throw new Error('REST source did not return a JSON array');
    const dir = await mkdtemp(join(tmpdir(), 'so-rest-'));
    const file = join(dir, 'data.json');
    await writeFile(file, JSON.stringify(arr));
    const session = await ctx.query.open();
    try {
      await session.all(`CREATE TEMP TABLE _ingest AS SELECT * FROM read_json_auto('${file}')`);
      return await register(orgId, conn.name, session);
    } finally { await session.close(); await rm(dir, { recursive: true, force: true }); }
  }

  return { createConnector, listConnectors, sync };
}
```

- [ ] **Step 7: `packages/connectors-cloud/src/routes.ts`**
```ts
import type { FastifyPluginAsync } from 'fastify';
import { requirePermission } from '@so/auth';
import { createCloudConnectorService } from './service.js';

export const cloudConnectorRoutes: FastifyPluginAsync = async (fastify) => {
  const svc = createCloudConnectorService(fastify.ctx);
  fastify.post('/s3', { preHandler: requirePermission('connectors:write') }, async (req, reply) => {
    const b = req.body as { name?: string; s3Url?: string; format?: string };
    if (!b?.name || !b?.s3Url) return reply.code(400).send({ error: 'name, s3Url required' });
    try { return reply.code(201).send({ id: await svc.createConnector(req.user!.orgId, { name: b.name, kind: 's3', config: { s3Url: b.s3Url, format: b.format ?? 'csv' } }) }); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });
  fastify.post('/rest', { preHandler: requirePermission('connectors:write') }, async (req, reply) => {
    const b = req.body as { name?: string; url?: string; arrayPath?: string };
    if (!b?.name || !b?.url) return reply.code(400).send({ error: 'name, url required' });
    try { return reply.code(201).send({ id: await svc.createConnector(req.user!.orgId, { name: b.name, kind: 'rest', config: { url: b.url, arrayPath: b.arrayPath } }) }); }
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

- [ ] **Step 8: `packages/connectors-cloud/src/index.ts`**
```ts
import { defineModule } from '@so/sdk';
import { runMigrations } from './migrate.js';
import { cloudConnectorRoutes } from './routes.js';

export default defineModule({
  id: 'connectors-cloud',
  dependsOn: ['datasets', 'auth'],
  contributes: { apiRoutes: cloudConnectorRoutes, permissions: ['connectors:read', 'connectors:write'] },
  async onInstall(ctx) { await runMigrations(ctx.db); },
});

export { createCloudConnectorService, type CloudConnectorInput } from './service.js';
```

- [ ] **Step 9: `packages/connectors-cloud/test/connectors-cloud.int.test.ts`**
```ts
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { createServer as createHttp, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createServer, createConfig, type AppServer } from '@so/server';
import { createLogger } from '@so/observability';
import authModule from '@so/auth';
import datasetsModule from '@so/datasets';
import cloudModule from '../src/index.js';

const config = createConfig({
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so',
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'localhost:9000', S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin', S3_BUCKET: process.env.S3_BUCKET ?? 'so-datasets',
  ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: 'admin',
});
let server: AppServer; let rest: Server; let restPort = 0;
beforeAll(async () => { rest = createHttp((_q, r) => { r.setHeader('content-type', 'application/json'); r.end(JSON.stringify([{ id: 1, name: 'x' }, { id: 2, name: 'y' }, { id: 3, name: 'z' }])); }); await new Promise<void>((res) => rest.listen(0, res)); restPort = (rest.address() as AddressInfo).port; });
afterAll(async () => { await server?.stop(); await new Promise<void>((res) => rest.close(() => res())); });
function cookieFrom(s: string | string[] | undefined): string { const raw = Array.isArray(s) ? s[0]! : s!; return raw.split(';')[0]!; }

describe('cloud connectors: S3 file + REST JSON', () => {
  it('ingests a CSV from S3 and a JSON array from REST', async () => {
    server = await createServer({ modules: [authModule, datasetsModule, cloudModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();
    const db = server.kernel.ctx.db;
    await db.query(`DELETE FROM cloud_connectors WHERE name IN ('s3conn','restconn')`);
    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const a = { cookie: cookieFrom(login.headers['set-cookie']) };

    // put a CSV into object storage, then ingest it via the S3 connector
    const key = 'org_default/incoming/cloudtest.csv';
    await server.kernel.ctx.objectStore.putObject(key, new TextEncoder().encode('id,label\n1,a\n2,b\n'));
    const s3Url = server.kernel.ctx.objectStore.getObjectUrl(key);
    const s3c = await server.app.inject({ method: 'POST', url: '/api/connectors-cloud/s3', headers: a, payload: { name: 's3conn', s3Url, format: 'csv' } });
    const s3sync = await server.app.inject({ method: 'POST', url: `/api/connectors-cloud/${s3c.json().id}/sync`, headers: a });
    expect(s3sync.json().rowCount).toBe(2);

    // REST connector against the local test server
    const rc = await server.app.inject({ method: 'POST', url: '/api/connectors-cloud/rest', headers: a, payload: { name: 'restconn', url: `http://localhost:${restPort}/` } });
    const rsync = await server.app.inject({ method: 'POST', url: `/api/connectors-cloud/${rc.json().id}/sync`, headers: a });
    expect(rsync.json().rowCount).toBe(3);
    const preview = await server.app.inject({ method: 'GET', url: `/api/datasets/${rsync.json().datasetId}/preview`, headers: a });
    expect((preview.json().rows as Array<{ name: string }>).map((r) => r.name).sort()).toEqual(['x', 'y', 'z']);
  });
});
```

- [ ] **Step 10: Run with infra up → PASS:** `pnpm run infra:up && pnpm --filter @so/connectors-cloud test` (timeout 180000). typecheck clean; no unused imports.

- [ ] **Step 11: Commit:** `git add -A && git commit -m "feat(connectors-cloud): S3 file + REST JSON connectors"`

---

## Task 2: Full verification + merge
- [ ] `pnpm run infra:up && pnpm run infra:seed && pnpm typecheck; pnpm lint; pnpm test` (exit codes) → green; `git checkout main && git merge --ff-only phase23/connectors-cloud`

---

## Self-review
- **Spec §6 (connectors: object store + REST)** — S3/object-store file ingestion + REST/JSON ingestion, both → datasets via DuckDB. ✓
- **Additive / self-contained** — new package; no merged code modified. ✓
- **Security** — admin-gated; s3:// and http(s):// URL validation; JSON must be an array. (SSRF on the REST URL is a known concern — allowlist deferred to hardening.) ✓
- **Deferred:** auth headers/secrets for REST, pagination, S3 across buckets/credentials, streaming, schema typing of JSON. Flagged.
