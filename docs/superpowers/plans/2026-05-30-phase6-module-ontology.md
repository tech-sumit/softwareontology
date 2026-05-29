# Phase 6 — module-ontology Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `@so/ontology` — the semantic core. Define **Object Types** (api name + backing dataset + primary key) with typed **Properties** (mapped to dataset columns) and **Link Types** (many-to-one), then **resolve live object instances** by feeding the stored mapping into `@so/query`'s `resolveObjectSet` (built & proven in Plan 1). This is what makes the platform an ontology rather than a file store.

**Architecture:** `@so/ontology` (dependsOn `datasets`, `auth`) stores object-type/property/link metadata in Postgres and **owns the write-back overlay tables** (`object_writeback`, `object_created`) that the resolver reads and the actions module (Plan 7) will write. `resolveObjects()` builds an `ObjectTypeMapping` from stored metadata + the backing dataset's object key, then calls `resolveObjectSet` (DuckDB over Parquet + overlay). Routes are protected with `requirePermission` from `@so/auth`.

**Tech Stack:** TypeScript, `@so/query` (`resolveObjectSet`), `@so/datasets` (backing dataset lookup), `@so/auth` (route guard), `ctx.db`/`ctx.objectStore`/`ctx.config`; integration-tested via `@so/server` against Docker Postgres + MinIO.

---

## Pre-flight

- [ ] **Branch:** `cd /Users/sumitagrawal/CODE/sumit/SoftwareOntology && git checkout main && git checkout -b phase6/module-ontology`

---

## File structure

```
packages/ontology/
  package.json     dep: @so/sdk @so/auth @so/datasets @so/query fastify ; devDep: @so/server @so/observability @types/node @types/pg
  tsconfig.json
  vitest.config.ts
  src/migrate.ts   object_types, object_properties, link_types, + overlay (object_writeback/object_created)
  src/service.ts   createOntologyService(ctx): createObjectType/get/list/createLinkType/resolveObjects
  src/routes.ts    ontologyRoutes (protected)
  src/index.ts     defineModule({ id:'ontology', dependsOn:['datasets','auth'], ... })
  test/ontology.int.test.ts   upload dataset → define Flight type → resolve objects
```

---

## Task 1: Package + migrations

**Files:** Create `packages/ontology/{package.json,tsconfig.json,vitest.config.ts,src/migrate.ts}`

- [ ] **Step 1: `packages/ontology/package.json`**

```json
{
  "name": "@so/ontology",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "dependencies": {
    "@so/sdk": "workspace:*",
    "@so/auth": "workspace:*",
    "@so/datasets": "workspace:*",
    "@so/query": "workspace:*",
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

- [ ] **Step 3: `packages/ontology/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "types": ["node"] },
  "include": ["src/**/*", "test/**/*"]
}
```

- [ ] **Step 4: `packages/ontology/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { testTimeout: 60_000, hookTimeout: 60_000 } });
```

- [ ] **Step 5: Create `packages/ontology/src/migrate.ts`**

```ts
import type { Db } from '@so/sdk';

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS object_types (
     id text PRIMARY KEY,
     org_id text NOT NULL,
     api_name text NOT NULL,
     dataset_id text NOT NULL,
     primary_key text NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     UNIQUE (org_id, api_name)
   )`,
  `CREATE TABLE IF NOT EXISTS object_properties (
     object_type_id text NOT NULL REFERENCES object_types(id),
     ordinal int NOT NULL,
     api_name text NOT NULL,
     column_name text NOT NULL,
     prop_type text NOT NULL,
     PRIMARY KEY (object_type_id, ordinal)
   )`,
  `CREATE TABLE IF NOT EXISTS link_types (
     id text PRIMARY KEY,
     org_id text NOT NULL,
     api_name text NOT NULL,
     from_object_type_id text NOT NULL REFERENCES object_types(id),
     to_object_type_id text NOT NULL REFERENCES object_types(id),
     foreign_key_property text NOT NULL,
     UNIQUE (org_id, api_name)
   )`,
  // Write-back overlay — the resolution contract. Resolver (@so/query) reads these;
  // the actions module (Plan 7) writes them. Created here so resolution works with
  // an empty overlay even before actions exist.
  `CREATE TABLE IF NOT EXISTS object_writeback (
     org_id text NOT NULL DEFAULT 'org_default',
     object_type text NOT NULL,
     primary_key text NOT NULL,
     property text NOT NULL,
     value text,
     version int NOT NULL DEFAULT 1,
     updated_by text,
     updated_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (org_id, object_type, primary_key, property, version)
   )`,
  `CREATE TABLE IF NOT EXISTS object_created (
     org_id text NOT NULL DEFAULT 'org_default',
     object_type text NOT NULL,
     primary_key text NOT NULL,
     payload jsonb NOT NULL,
     created_by text,
     created_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (org_id, object_type, primary_key)
   )`,
];

export async function runMigrations(db: Db): Promise<void> {
  for (const sql of MIGRATIONS) await db.query(sql);
}
```

- [ ] **Step 6: Typecheck + commit**

```bash
pnpm --filter @so/ontology run typecheck
git add -A && git commit -m "feat(ontology): package + metadata & write-back-overlay migrations"
```

---

## Task 2: Ontology service

**Files:** Create `packages/ontology/src/service.ts`. (Exercised by Task 3's integration test.)

- [ ] **Step 1: Create `packages/ontology/src/service.ts`**

```ts
import { randomUUID } from 'node:crypto';
import type { ModuleContext } from '@so/sdk';
import { resolveObjectSet, type ObjectTypeMapping, type PropType, type Filter } from '@so/query';
import { createDatasetService } from '@so/datasets';

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const VALID_TYPES: ReadonlySet<string> = new Set(['string', 'int', 'float', 'bool', 'timestamp']);

export interface PropertyInput { apiName: string; column: string; type: PropType; }
export interface ObjectTypeInput { apiName: string; datasetId: string; primaryKey: string; properties: PropertyInput[]; }
export interface ObjectTypeSummary { apiName: string; datasetId: string; primaryKey: string; }
export interface ObjectTypeDetail extends ObjectTypeSummary { id: string; objectKey: string; properties: PropertyInput[]; }

export function createOntologyService(ctx: ModuleContext) {
  const datasets = createDatasetService(ctx);

  function validate(input: ObjectTypeInput): void {
    if (!NAME_RE.test(input.apiName)) throw new Error(`invalid object type name: ${input.apiName}`);
    if (input.properties.length === 0) throw new Error('at least one property required');
    for (const p of input.properties) {
      if (!NAME_RE.test(p.apiName)) throw new Error(`invalid property name: ${p.apiName}`);
      if (!NAME_RE.test(p.column)) throw new Error(`invalid column name: ${p.column}`);
      if (!VALID_TYPES.has(p.type)) throw new Error(`invalid prop type: ${p.type}`);
    }
    if (!input.properties.some((p) => p.apiName === input.primaryKey)) {
      throw new Error(`primaryKey '${input.primaryKey}' must be one of the properties`);
    }
  }

  async function createObjectType(orgId: string, input: ObjectTypeInput): Promise<ObjectTypeSummary> {
    validate(input);
    const ds = await datasets.get(orgId, input.datasetId);
    if (!ds) throw new Error(`dataset not found: ${input.datasetId}`);
    const id = randomUUID();
    await ctx.db.query(
      `INSERT INTO object_types(id,org_id,api_name,dataset_id,primary_key) VALUES ($1,$2,$3,$4,$5)`,
      [id, orgId, input.apiName, input.datasetId, input.primaryKey],
    );
    for (let i = 0; i < input.properties.length; i++) {
      const p = input.properties[i]!;
      await ctx.db.query(
        `INSERT INTO object_properties(object_type_id,ordinal,api_name,column_name,prop_type) VALUES ($1,$2,$3,$4,$5)`,
        [id, i, p.apiName, p.column, p.type],
      );
    }
    return { apiName: input.apiName, datasetId: input.datasetId, primaryKey: input.primaryKey };
  }

  async function listObjectTypes(orgId: string): Promise<ObjectTypeSummary[]> {
    const rows = await ctx.db.query<{ api_name: string; dataset_id: string; primary_key: string }>(
      `SELECT api_name, dataset_id, primary_key FROM object_types WHERE org_id = $1 ORDER BY api_name`,
      [orgId],
    );
    return rows.map((r) => ({ apiName: r.api_name, datasetId: r.dataset_id, primaryKey: r.primary_key }));
  }

  async function getObjectType(orgId: string, apiName: string): Promise<ObjectTypeDetail | null> {
    const rows = await ctx.db.query<{ id: string; dataset_id: string; primary_key: string }>(
      `SELECT id, dataset_id, primary_key FROM object_types WHERE org_id = $1 AND api_name = $2`,
      [orgId, apiName],
    );
    const r = rows[0];
    if (!r) return null;
    const props = await ctx.db.query<{ api_name: string; column_name: string; prop_type: string }>(
      `SELECT api_name, column_name, prop_type FROM object_properties WHERE object_type_id = $1 ORDER BY ordinal`,
      [r.id],
    );
    const ds = await datasets.get(orgId, r.dataset_id);
    if (!ds) throw new Error(`backing dataset missing for object type ${apiName}`);
    return {
      id: r.id, apiName, datasetId: r.dataset_id, primaryKey: r.primary_key, objectKey: ds.objectKey,
      properties: props.map((p) => ({ apiName: p.api_name, column: p.column_name, type: p.prop_type as PropType })),
    };
  }

  async function createLinkType(
    orgId: string,
    input: { apiName: string; fromObjectType: string; toObjectType: string; foreignKeyProperty: string },
  ): Promise<void> {
    if (!NAME_RE.test(input.apiName)) throw new Error(`invalid link name: ${input.apiName}`);
    const from = await getObjectType(orgId, input.fromObjectType);
    const to = await getObjectType(orgId, input.toObjectType);
    if (!from || !to) throw new Error('from/to object type not found');
    await ctx.db.query(
      `INSERT INTO link_types(id,org_id,api_name,from_object_type_id,to_object_type_id,foreign_key_property)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [randomUUID(), orgId, input.apiName, from.id, to.id, input.foreignKeyProperty],
    );
  }

  async function resolveObjects(
    orgId: string,
    apiName: string,
    options?: { filters?: Filter[]; limit?: number; offset?: number },
  ): Promise<Record<string, unknown>[]> {
    const ot = await getObjectType(orgId, apiName);
    if (!ot) throw new Error(`object type not found: ${apiName}`);
    const mapping: ObjectTypeMapping = {
      objectType: ot.apiName,
      primaryKey: ot.primaryKey,
      properties: ot.properties.map((p) => ({ name: p.apiName, column: p.column, type: p.type })),
      backing: { kind: 's3', path: ctx.objectStore.getObjectUrl(ot.objectKey) },
    };
    return resolveObjectSet({
      mapping,
      pgConnString: ctx.config.require('DATABASE_URL'),
      s3: {
        endpoint: ctx.config.require('S3_ENDPOINT'),
        accessKeyId: ctx.config.require('S3_ACCESS_KEY_ID'),
        secretAccessKey: ctx.config.require('S3_SECRET_ACCESS_KEY'),
        region: ctx.config.get('S3_REGION') ?? 'us-east-1',
        useSsl: ctx.config.get('S3_USE_SSL') === 'true',
      },
      options: options ?? {},
    });
  }

  return { createObjectType, listObjectTypes, getObjectType, createLinkType, resolveObjects };
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm --filter @so/ontology run typecheck
git add -A && git commit -m "feat(ontology): metadata service + resolveObjects via @so/query"
```

---

## Task 3: Routes + module + integration test (the core proof)

**Files:** Create `packages/ontology/src/routes.ts`, `packages/ontology/src/index.ts`, `packages/ontology/test/ontology.int.test.ts`

- [ ] **Step 1: Create `packages/ontology/src/routes.ts`**

```ts
import type { FastifyPluginAsync } from 'fastify';
import { requirePermission } from '@so/auth';
import { createOntologyService, type ObjectTypeInput } from './service.js';

export const ontologyRoutes: FastifyPluginAsync = async (fastify) => {
  const svc = createOntologyService(fastify.ctx);

  fastify.post('/object-types', { preHandler: requirePermission('ontology:edit') }, async (req, reply) => {
    const body = req.body as ObjectTypeInput;
    if (!body?.apiName || !body?.datasetId || !body?.primaryKey || !Array.isArray(body?.properties)) {
      return reply.code(400).send({ error: 'apiName, datasetId, primaryKey, properties[] required' });
    }
    try {
      const ot = await svc.createObjectType(req.user!.orgId, body);
      return reply.code(201).send({ objectType: ot });
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  fastify.get('/object-types', { preHandler: requirePermission('ontology:read') }, async (req) => {
    return { objectTypes: await svc.listObjectTypes(req.user!.orgId) };
  });

  fastify.get('/object-types/:apiName', { preHandler: requirePermission('ontology:read') }, async (req, reply) => {
    const { apiName } = req.params as { apiName: string };
    const ot = await svc.getObjectType(req.user!.orgId, apiName);
    if (!ot) return reply.code(404).send({ error: 'not found' });
    return { objectType: { apiName: ot.apiName, datasetId: ot.datasetId, primaryKey: ot.primaryKey, properties: ot.properties } };
  });

  fastify.get('/object-types/:apiName/objects', { preHandler: requirePermission('ontology:read') }, async (req, reply) => {
    const { apiName } = req.params as { apiName: string };
    const q = req.query as { limit?: string; offset?: string };
    try {
      const objects = await svc.resolveObjects(req.user!.orgId, apiName, {
        limit: Number(q.limit ?? 100),
        offset: Number(q.offset ?? 0),
      });
      return { objects };
    } catch (e) {
      return reply.code(404).send({ error: (e as Error).message });
    }
  });

  fastify.post('/link-types', { preHandler: requirePermission('ontology:edit') }, async (req, reply) => {
    const body = req.body as { apiName?: string; fromObjectType?: string; toObjectType?: string; foreignKeyProperty?: string };
    if (!body?.apiName || !body?.fromObjectType || !body?.toObjectType || !body?.foreignKeyProperty) {
      return reply.code(400).send({ error: 'apiName, fromObjectType, toObjectType, foreignKeyProperty required' });
    }
    try {
      await svc.createLinkType(req.user!.orgId, body as Required<typeof body>);
      return reply.code(201).send({ ok: true });
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });
};
```

- [ ] **Step 2: Create `packages/ontology/src/index.ts`**

```ts
import { defineModule } from '@so/sdk';
import { runMigrations } from './migrate.js';
import { ontologyRoutes } from './routes.js';

export default defineModule({
  id: 'ontology',
  dependsOn: ['datasets', 'auth'],
  contributes: {
    apiRoutes: ontologyRoutes,
    permissions: ['ontology:read', 'ontology:edit'],
  },
  async onInstall(ctx) {
    await runMigrations(ctx.db);
  },
});

export { createOntologyService, type ObjectTypeInput, type ObjectTypeDetail } from './service.js';
```

- [ ] **Step 3: Create `packages/ontology/test/ontology.int.test.ts`**

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { createServer, createConfig, type AppServer } from '@so/server';
import { createLogger } from '@so/observability';
import authModule from '@so/auth';
import datasetsModule from '@so/datasets';
import ontologyModule from '../src/index.js';

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

describe('ontology: define an object type and resolve its objects', () => {
  it('uploads a dataset, models it, and resolves live objects', async () => {
    server = await createServer({ modules: [authModule, datasetsModule, ontologyModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();

    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const cookie = cookieFrom(login.headers['set-cookie']);

    const upload = await server.app.inject({
      method: 'POST', url: '/api/datasets?name=flights6&format=csv',
      headers: { cookie, 'content-type': 'text/csv' },
      payload: 'flight_no,status,seats\nFL-204,Delayed,189\nFL-118,Boarding,142\nFL-552,On time,200\n',
    });
    const datasetId = upload.json().dataset.id as string;

    const create = await server.app.inject({
      method: 'POST', url: '/api/ontology/object-types',
      headers: { cookie },
      payload: {
        apiName: 'Flight', datasetId, primaryKey: 'flightNumber',
        properties: [
          { apiName: 'flightNumber', column: 'flight_no', type: 'string' },
          { apiName: 'status', column: 'status', type: 'string' },
          { apiName: 'seats', column: 'seats', type: 'int' },
        ],
      },
    });
    expect(create.statusCode).toBe(201);

    const objs = await server.app.inject({ method: 'GET', url: '/api/ontology/object-types/Flight/objects', headers: { cookie } });
    expect(objs.statusCode).toBe(200);
    const objects = objs.json().objects as Array<{ flightNumber: string; status: string; seats: number }>;
    expect(objects).toHaveLength(3);
    const fl204 = objects.find((o) => o.flightNumber === 'FL-204');
    expect(fl204?.status).toBe('Delayed');
    expect(fl204?.seats).toBe(189);

    const list = await server.app.inject({ method: 'GET', url: '/api/ontology/object-types', headers: { cookie } });
    expect(list.json().objectTypes.some((t: { apiName: string }) => t.apiName === 'Flight')).toBe(true);
  });

  it('rejects unauthenticated resolution', async () => {
    const res = await server.app.inject({ method: 'GET', url: '/api/ontology/object-types/Flight/objects' });
    expect(res.statusCode).toBe(401);
  });
});
```

- [ ] **Step 4: Run with infra up → PASS**

```bash
pnpm run infra:up
pnpm --filter @so/ontology test
```
Expected: 2 tests pass — the first proves dataset→object-type→**resolved objects** (FL-204 status Delayed, seats 189), the second proves auth protection. (Bash timeout 180000.) Then `pnpm --filter @so/ontology run typecheck` (clean).

> The resolver reads `object_writeback`/`object_created` (created by this module's migration, empty here) plus the dataset Parquet in MinIO. `seats` is `int` → DuckDB `INTEGER` → JS `number` (189). If resolution errors on a missing overlay table, confirm Task 1's migration ran (kernel onInstall).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(ontology): object-type/link routes + resolveObjects (the semantic core)"
```

---

## Task 4: Full verification + merge

- [ ] **Step 1: Full suite**

```bash
pnpm run infra:up && pnpm run infra:seed
pnpm typecheck && pnpm lint && pnpm test
```
Expected: typecheck + lint clean; **41 tests** (prior 39 + ontology 2).

- [ ] **Step 2: Merge**

```bash
git checkout main && git merge --ff-only phase6/module-ontology
```

---

## Done criteria

- `@so/ontology` defines Object Types with typed Properties mapped to dataset columns, plus many-to-one Link Types, all org-scoped and stored in Postgres.
- `GET /api/ontology/object-types/:apiName/objects` returns **live object instances** resolved from the backing dataset via `resolveObjectSet` (Parquet + write-back overlay through DuckDB).
- Routes are auth-protected; the overlay tables exist for the actions module to write next.
- Full suite green.

Plan 7 (`module-actions`) adds validated, ACID write-back: define an Action, run it, and the edit shows up in the resolved objects (overlay overrides base) — exactly the mechanism `@so/query` proved in Plan 1.

---

## Self-review (against the spec)

- **Spec §6 (module-ontology)** — Object Types, Properties (typed, mapped to columns), Link Types (many-to-one), dataset→object mapping, and the resolution API wiring `resolveObjectSet`. ✓
- **Spec §7 (resolution model)** — `resolveObjects` builds the exact `ObjectTypeMapping` the Plan-1 resolver consumes; this module owns the write-back overlay tables the resolver reads. ✓
- **Spec §8 (NFRs)** — name/type validation on object-type creation (defense matching the resolver's `ident()` guard), parameterized SQL, org-scoped metadata, auth-protected routes, integration-tested end-to-end. ✓
- **Placeholder scan** — complete code; the overlay-table note is a diagnostic. ✓
- **Type consistency** — `PropType`/`ObjectTypeMapping`/`Filter` imported from `@so/query` and used unchanged; `PropertyInput`/`ObjectTypeInput`/`ObjectTypeDetail` defined once; `req.user!.orgId` (Plan 5 augmentation), `fastify.ctx` (Plan 3). ✓
- **Deliberately deferred:** link *traversal* in resolution (links are stored; resolving linked objects is Plan 8 explorer/later), many-to-many links (Phase 2), property-level security, org-scoping inside the overlay resolution query (single-org now; the resolver doesn't yet filter overlay by org_id — fine until multi-tenant activation). Flagged, not silent.
```
