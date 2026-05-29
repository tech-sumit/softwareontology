# Phase 1 — Foundation & Resolution Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the SoftwareOntology monorepo and prove the riskiest mechanism in the whole system — resolving ontology objects by merging an immutable Parquet dataset (read via DuckDB) with a Postgres write-back overlay — behind a tested, reusable `resolveObjectSet()` function.

**Architecture:** A pnpm + Turborepo TypeScript monorepo. A `@so/query` package wraps an in-process DuckDB session, `ATTACH`es Postgres (via DuckDB's `postgres` extension), and generates SQL that LEFT-merges base Parquet columns with the EAV overlay (`object_writeback`) and `UNION ALL`s net-new objects (`object_created`). Local Postgres + MinIO run via Docker Compose; integration tests run against them.

**Tech Stack:** pnpm 10, Turborepo, TypeScript 5 (strict, ESM/NodeNext), Vitest, `duckdb-async`, `pg`, Docker Compose (postgres:16, minio, minio/mc), DuckDB extensions `postgres`/`httpfs`/`json`.

---

## Pre-flight (do once before Task 1)

- [ ] **Create a feature branch** (we are on `main`):

```bash
cd /Users/sumitagrawal/CODE/sumit/SoftwareOntology
git checkout -b phase1/foundation-resolution-spike
```

> **Air-gap note:** DuckDB `INSTALL postgres/httpfs/json` fetches extensions from the internet on first run. That is acceptable for this spike. A later Phase-2 task will pin and vendor these extensions into the image to honor the air-gap rules (spec §9). Do not solve that here.

---

## File structure (created by this plan)

```
package.json                         root: pnpm workspace + turbo scripts
pnpm-workspace.yaml                  workspace globs
turbo.json                           turbo pipeline
.npmrc                               pnpm settings
tsconfig.base.json                   shared strict TS config
vitest.workspace.ts                  vitest workspace
.env.example                         documented env vars
docker-compose.yml                   postgres + minio + bucket init
scripts/seed-overlay.sql             overlay DDL + spike seed data
.github/workflows/ci.yml             typecheck + lint + test
packages/query/
  package.json                       @so/query
  tsconfig.json
  src/index.ts                       public exports
  src/types.ts                       ObjectTypeMapping, ResolveOptions, etc.
  src/duckdb.ts                      session helpers (open, attach pg, configure s3)
  src/sql.ts                         buildResolveSql() — the SQL generator
  src/resolver.ts                    resolveObjectSet() — high-level API
  test/fixtures.ts                   writes a flights Parquet fixture via DuckDB
  test/resolver.int.test.ts          integration tests (local + S3 backing)
```

Each `@so/query` source file has one responsibility: `types` (shape), `duckdb` (session/connection plumbing), `sql` (pure SQL generation — unit-testable without a DB), `resolver` (orchestration). `sql.ts` being pure is deliberate: the trickiest logic gets fast unit tests *and* integration tests.

---

## Task 1: Monorepo scaffold

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `.npmrc`, `tsconfig.base.json`, `vitest.workspace.ts`

- [ ] **Step 1: Create `.npmrc`**

```ini
auto-install-peers=true
strict-peer-dependencies=false
```

- [ ] **Step 2: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - 'packages/*'
  - 'modules/*'
  - 'apps/*'
```

- [ ] **Step 3: Create root `package.json`**

```json
{
  "name": "softwareontology",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "packageManager": "pnpm@10.28.1",
  "scripts": {
    "build": "turbo run build",
    "typecheck": "turbo run typecheck",
    "lint": "eslint .",
    "test": "vitest run",
    "test:watch": "vitest",
    "infra:up": "docker compose up -d --wait postgres minio && docker compose run --rm createbuckets",
    "infra:down": "docker compose down -v",
    "infra:seed": "docker compose exec -T postgres psql -U so -d so -v ON_ERROR_STOP=1 < scripts/seed-overlay.sql"
  },
  "devDependencies": {
    "turbo": "^2.5.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0",
    "eslint": "^9.18.0",
    "@eslint/js": "^9.18.0",
    "typescript-eslint": "^8.20.0",
    "tsx": "^4.19.0"
  }
}
```

- [ ] **Step 4: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2023"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "declaration": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "verbatimModuleSyntax": true
  }
}
```

- [ ] **Step 5: Create `turbo.json`**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "typecheck": { "dependsOn": ["^build"] },
    "test": { "dependsOn": ["^build"] }
  }
}
```

- [ ] **Step 6: Create `vitest.workspace.ts`**

```ts
export default ['packages/*'];
```

- [ ] **Step 7: Create `eslint.config.js`**

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
```

- [ ] **Step 8: Install and verify the workspace resolves**

Run:
```bash
pnpm install
pnpm exec tsc --version
```
Expected: install completes; `tsc` prints `Version 5.7.x`.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold pnpm + turborepo monorepo"
```

---

## Task 2: Local infrastructure (Postgres + MinIO)

**Files:**
- Create: `docker-compose.yml`, `.env.example`, `scripts/seed-overlay.sql`

- [ ] **Step 1: Create `docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: so
      POSTGRES_PASSWORD: so
      POSTGRES_DB: so
    ports: ["5432:5432"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U so -d so"]
      interval: 2s
      timeout: 3s
      retries: 20

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    ports: ["9000:9000", "9001:9001"]
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 2s
      timeout: 3s
      retries: 20

  createbuckets:
    image: minio/mc:latest
    profiles: ["init"]   # one-shot; kept out of `up --wait`, run via `compose run`
    depends_on:
      minio:
        condition: service_healthy
    entrypoint: >
      /bin/sh -c "
      mc alias set local http://minio:9000 minioadmin minioadmin &&
      mc mb --ignore-existing local/so-datasets &&
      echo 'bucket ready'
      "
```

- [ ] **Step 2: Create `.env.example`**

```bash
# Postgres
DATABASE_URL=postgresql://so:so@localhost:5432/so
# Object store (S3 API / MinIO)
S3_ENDPOINT=localhost:9000
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_BUCKET=so-datasets
S3_REGION=us-east-1
S3_USE_SSL=false
```

- [ ] **Step 3: Create `scripts/seed-overlay.sql`** (overlay schema + spike seed data)

```sql
CREATE TABLE IF NOT EXISTS object_writeback (
  org_id      text        NOT NULL DEFAULT 'org_default',
  object_type text        NOT NULL,
  primary_key text        NOT NULL,
  property    text        NOT NULL,
  value       text,
  version     int         NOT NULL DEFAULT 1,
  updated_by  text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, object_type, primary_key, property, version)
);

CREATE TABLE IF NOT EXISTS object_created (
  org_id      text        NOT NULL DEFAULT 'org_default',
  object_type text        NOT NULL,
  primary_key text        NOT NULL,
  payload     jsonb       NOT NULL,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, object_type, primary_key)
);

-- deterministic seed for the spike: wipe then insert
TRUNCATE object_writeback;
TRUNCATE object_created;

-- an Action edited FL-204's status from base 'On time' to 'Delayed'
INSERT INTO object_writeback (object_type, primary_key, property, value)
VALUES ('Flight', 'FL-204', 'status', 'Delayed');

-- an Action created a net-new flight not present in the base dataset
INSERT INTO object_created (object_type, primary_key, payload)
VALUES ('Flight', 'FL-900',
  '{"flightNumber":"FL-900","status":"Scheduled","departureAt":"2026-05-29 14:00:00","seats":120}');
```

- [ ] **Step 4: Bring infra up and verify health**

Run:
```bash
docker compose up -d --wait
docker compose ps
```
Expected: `postgres` and `minio` show `healthy`; `createbuckets` exits `0` after printing `bucket ready`.

- [ ] **Step 5: Apply the seed and verify**

Run:
```bash
docker compose exec -T postgres psql -U so -d so -v ON_ERROR_STOP=1 < scripts/seed-overlay.sql
docker compose exec -T postgres psql -U so -d so -c "SELECT count(*) FROM object_writeback;"
```
Expected: `count` = `1`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: local infra (postgres + minio) and overlay seed"
```

---

## Task 3: `@so/query` package + types + DuckDB session

**Files:**
- Create: `packages/query/package.json`, `packages/query/tsconfig.json`, `packages/query/src/types.ts`, `packages/query/src/duckdb.ts`, `packages/query/src/index.ts`

- [ ] **Step 1: Create `packages/query/package.json`**

```json
{
  "name": "@so/query",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "duckdb-async": "^1.1.3",
    "pg": "^8.13.0"
  },
  "devDependencies": {
    "@types/pg": "^8.11.0",
    "@types/node": "^22.10.0"
  }
}
```

- [ ] **Step 2: Create `packages/query/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist", "types": ["node"] },
  "include": ["src/**/*", "test/**/*"]
}
```

- [ ] **Step 3: Create `packages/query/src/types.ts`**

```ts
export type PropType = 'string' | 'int' | 'float' | 'bool' | 'timestamp';

export interface PropertyMapping {
  /** Ontology property name, e.g. "flightNumber" */
  name: string;
  /** Backing dataset column, e.g. "flight_no" */
  column: string;
  type: PropType;
}

export interface ObjectTypeMapping {
  /** Object type id, e.g. "Flight" */
  objectType: string;
  /** Name of the property that is the primary key (must exist in `properties`) */
  primaryKey: string;
  properties: PropertyMapping[];
  backing: { kind: 'localFile' | 's3'; path: string };
}

export type FilterOp = '=' | '!=' | '>' | '<' | '>=' | '<=';

export interface Filter {
  property: string;
  op: FilterOp;
  value: string | number | boolean;
}

export interface ResolveOptions {
  filters?: Filter[];
  limit?: number;
  offset?: number;
}

export interface S3Options {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  useSsl?: boolean;
}
```

- [ ] **Step 4: Write the failing test for DuckDB session + local Parquet read**

Create `packages/query/test/fixtures.ts`:
```ts
import { Database } from 'duckdb-async';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Writes a small flights Parquet fixture and returns its absolute path. */
export async function writeFlightsParquet(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'so-fixture-'));
  const path = join(dir, 'flights.parquet');
  const db = await Database.create(':memory:');
  try {
    await db.all(`
      COPY (
        SELECT * FROM (VALUES
          ('FL-204', 'On time',  TIMESTAMP '2026-05-29 09:40:00', 189),
          ('FL-118', 'Boarding', TIMESTAMP '2026-05-29 10:15:00', 142),
          ('FL-552', 'On time',  TIMESTAMP '2026-05-29 10:50:00', 200)
        ) AS t(flight_no, status, dep_ts, seats)
      ) TO '${path}' (FORMAT parquet);
    `);
  } finally {
    await db.close();
  }
  return path;
}
```

Create `packages/query/test/resolver.int.test.ts`:
```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { openDuckDb } from '../src/duckdb.js';
import { writeFlightsParquet } from './fixtures.js';

let parquetPath: string;
beforeAll(async () => { parquetPath = await writeFlightsParquet(); });

describe('duckdb session', () => {
  it('reads a local parquet file', async () => {
    const db = await openDuckDb();
    try {
      const rows = await db.all(`SELECT count(*)::int AS n FROM read_parquet('${parquetPath}')`);
      expect(rows[0]).toEqual({ n: 3 });
    } finally {
      await db.close();
    }
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run:
```bash
pnpm --filter @so/query test
```
Expected: FAIL — `Cannot find module '../src/duckdb.js'` (file not created yet).

- [ ] **Step 6: Implement `packages/query/src/duckdb.ts`**

```ts
import { Database } from 'duckdb-async';
import type { S3Options } from './types.js';

export type DuckDb = Database;

/** Opens an in-process DuckDB session with json + postgres + httpfs loaded. */
export async function openDuckDb(): Promise<DuckDb> {
  const db = await Database.create(':memory:');
  for (const ext of ['json', 'postgres', 'httpfs']) {
    await db.all(`INSTALL ${ext}`);
    await db.all(`LOAD ${ext}`);
  }
  return db;
}

/** ATTACH a Postgres database read-only under the given alias. */
export async function attachPostgres(db: DuckDb, connString: string, alias = 'pg'): Promise<void> {
  await db.all(`ATTACH '${connString}' AS ${alias} (TYPE postgres, READ_ONLY)`);
}

/** Configure S3 (MinIO) credentials so read_parquet('s3://...') works. */
export async function configureS3(db: DuckDb, s3: S3Options): Promise<void> {
  await db.all(`SET s3_endpoint='${s3.endpoint}'`);
  await db.all(`SET s3_access_key_id='${s3.accessKeyId}'`);
  await db.all(`SET s3_secret_access_key='${s3.secretAccessKey}'`);
  await db.all(`SET s3_region='${s3.region ?? 'us-east-1'}'`);
  await db.all(`SET s3_url_style='path'`);
  await db.all(`SET s3_use_ssl=${s3.useSsl ?? false}`);
}
```

- [ ] **Step 7: Create `packages/query/src/index.ts`**

```ts
export * from './types.js';
export { openDuckDb, attachPostgres, configureS3 } from './duckdb.js';
```

- [ ] **Step 8: Run the test to verify it passes**

Run:
```bash
pnpm --filter @so/query test
```
Expected: PASS (1 test). First run downloads DuckDB extensions; allow up to ~30s.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(query): @so/query package with duckdb session + local parquet read"
```

---

## Task 4: SQL generator (`buildResolveSql`) — pure, unit-tested

**Files:**
- Create: `packages/query/src/sql.ts`, `packages/query/test/sql.test.ts`
- Modify: `packages/query/src/index.ts`

- [ ] **Step 1: Write the failing unit test**

Create `packages/query/test/sql.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildResolveSql } from '../src/sql.js';
import type { ObjectTypeMapping } from '../src/types.js';

const flight: ObjectTypeMapping = {
  objectType: 'Flight',
  primaryKey: 'flightNumber',
  properties: [
    { name: 'flightNumber', column: 'flight_no', type: 'string' },
    { name: 'status', column: 'status', type: 'string' },
    { name: 'departureAt', column: 'dep_ts', type: 'timestamp' },
    { name: 'seats', column: 'seats', type: 'int' },
  ],
  backing: { kind: 'localFile', path: '/tmp/flights.parquet' },
};

describe('buildResolveSql', () => {
  it('merges overlay via COALESCE and unions created objects', () => {
    const { sql, params } = buildResolveSql(flight, 'pg', {});
    expect(sql).toContain(`read_parquet('/tmp/flights.parquet')`);
    expect(sql).toContain('object_writeback');
    expect(sql).toContain('object_created');
    expect(sql).toContain('COALESCE');
    expect(sql).toContain(`AS "status"`);
    expect(sql).toContain('UNION ALL');
    expect(params).toEqual([]);
  });

  it('parameterizes filter values and rejects bad operators', () => {
    const { sql, params } = buildResolveSql(flight, 'pg', {
      filters: [{ property: 'status', op: '=', value: 'Delayed' }],
      limit: 10,
    });
    expect(sql).toContain(`WHERE "status" = ?`);
    expect(sql).toContain('LIMIT 10');
    expect(params).toEqual(['Delayed']);
    expect(() =>
      buildResolveSql(flight, 'pg', { filters: [{ property: 'x', op: 'DROP' as never, value: 1 }] }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
pnpm --filter @so/query test sql
```
Expected: FAIL — `Cannot find module '../src/sql.js'`.

- [ ] **Step 3: Implement `packages/query/src/sql.ts`**

```ts
import type { ObjectTypeMapping, PropType, FilterOp, ResolveOptions } from './types.js';

const DUCK_TYPE: Record<PropType, string> = {
  string: 'VARCHAR',
  int: 'BIGINT',
  float: 'DOUBLE',
  bool: 'BOOLEAN',
  timestamp: 'TIMESTAMP',
};

const ALLOWED_OPS: Record<FilterOp, string> = {
  '=': '=', '!=': '!=', '>': '>', '<': '<', '>=': '>=', '<=': '<=',
};

/** Trusted-config identifiers only. Guard against SQL injection via config. */
function ident(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Unsafe identifier: ${name}`);
  }
  return name;
}

export function buildResolveSql(
  m: ObjectTypeMapping,
  pgAlias: string,
  opts: ResolveOptions,
): { sql: string; params: unknown[] } {
  const ot = ident(m.objectType);
  const pkProp = m.properties.find((p) => p.name === m.primaryKey);
  if (!pkProp) throw new Error(`primaryKey '${m.primaryKey}' not in properties`);

  const baseRef = `read_parquet('${m.backing.path}')`;

  const baseCols = m.properties
    .map((p) => {
      const col = ident(p.column);
      const prop = ident(p.name);
      const overlay =
        `(SELECT w.value FROM ${pgAlias}.public.object_writeback w ` +
        `WHERE w.object_type = '${ot}' ` +
        `AND w.primary_key = CAST(base."${ident(pkProp.column)}" AS VARCHAR) ` +
        `AND w.property = '${prop}' ORDER BY w.version DESC LIMIT 1)`;
      return `COALESCE(CAST(${overlay} AS ${DUCK_TYPE[p.type]}), base."${col}") AS "${prop}"`;
    })
    .join(',\n    ');

  const createdCols = m.properties
    .map((p) => `CAST(json_extract_string(c.payload, '${ident(p.name)}') AS ${DUCK_TYPE[p.type]}) AS "${ident(p.name)}"`)
    .join(',\n    ');

  const params: unknown[] = [];
  let where = '';
  if (opts.filters?.length) {
    const clauses = opts.filters.map((f) => {
      const op = ALLOWED_OPS[f.op];
      if (!op) throw new Error(`Disallowed operator: ${f.op}`);
      params.push(f.value);
      return `"${ident(f.property)}" ${op} ?`;
    });
    where = `WHERE ${clauses.join(' AND ')}`;
  }

  const limit = Number.isInteger(opts.limit) ? opts.limit : 100;
  const offset = Number.isInteger(opts.offset) ? opts.offset : 0;

  const sql =
`WITH resolved AS (
  SELECT
    ${baseCols}
  FROM ${baseRef} base
  UNION ALL
  SELECT
    ${createdCols}
  FROM ${pgAlias}.public.object_created c
  WHERE c.object_type = '${ot}'
)
SELECT * FROM resolved
${where}
ORDER BY "${ident(m.primaryKey)}"
LIMIT ${limit} OFFSET ${offset}`;

  return { sql, params };
}
```

- [ ] **Step 4: Export it — modify `packages/query/src/index.ts`**

Add to the existing exports:
```ts
export { buildResolveSql } from './sql.js';
```

- [ ] **Step 5: Run the test to verify it passes**

Run:
```bash
pnpm --filter @so/query test sql
```
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(query): pure SQL generator for overlay-merged resolution"
```

---

## Task 5: `resolveObjectSet` against local Parquet + Postgres overlay (THE CRUX)

**Files:**
- Create: `packages/query/src/resolver.ts`
- Modify: `packages/query/src/index.ts`, `packages/query/test/resolver.int.test.ts`

> Requires infra up + seeded (Task 2). This test proves edits override base values and created objects appear.

- [ ] **Step 1: Add the failing integration test — append to `packages/query/test/resolver.int.test.ts`**

```ts
import { resolveObjectSet } from '../src/resolver.js';
import type { ObjectTypeMapping } from '../src/types.js';

const PG = process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so';

function flightMapping(path: string): ObjectTypeMapping {
  return {
    objectType: 'Flight',
    primaryKey: 'flightNumber',
    properties: [
      { name: 'flightNumber', column: 'flight_no', type: 'string' },
      { name: 'status', column: 'status', type: 'string' },
      { name: 'departureAt', column: 'dep_ts', type: 'timestamp' },
      { name: 'seats', column: 'seats', type: 'int' },
    ],
    backing: { kind: 'localFile', path },
  };
}

describe('resolveObjectSet (local backing + overlay)', () => {
  it('overlay edit overrides the base value', async () => {
    const rows = await resolveObjectSet({
      mapping: flightMapping(parquetPath),
      pgConnString: PG,
      options: { filters: [{ property: 'flightNumber', op: '=', value: 'FL-204' }] },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('Delayed'); // base was 'On time'
  });

  it('created object appears in the result set', async () => {
    const rows = await resolveObjectSet({ mapping: flightMapping(parquetPath), pgConnString: PG });
    const ids = rows.map((r) => r.flightNumber).sort();
    expect(ids).toEqual(['FL-118', 'FL-204', 'FL-552', 'FL-900']); // 3 base + 1 created
    expect(rows.find((r) => r.flightNumber === 'FL-900')?.status).toBe('Scheduled');
  });

  it('unedited base rows pass through unchanged', async () => {
    const rows = await resolveObjectSet({
      mapping: flightMapping(parquetPath),
      pgConnString: PG,
      options: { filters: [{ property: 'flightNumber', op: '=', value: 'FL-552' }] },
    });
    expect(rows[0]?.status).toBe('On time');
    expect(rows[0]?.seats).toBe(200);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
pnpm run infra:up && pnpm run infra:seed
pnpm --filter @so/query test resolver
```
Expected: FAIL — `Cannot find module '../src/resolver.js'`.

- [ ] **Step 3: Implement `packages/query/src/resolver.ts`**

```ts
import { openDuckDb, attachPostgres, configureS3 } from './duckdb.js';
import { buildResolveSql } from './sql.js';
import type { ObjectTypeMapping, ResolveOptions, S3Options } from './types.js';

export interface ResolveArgs {
  mapping: ObjectTypeMapping;
  pgConnString: string;
  s3?: S3Options;
  options?: ResolveOptions;
}

/** Resolve an object set: base Parquet merged with the Postgres write-back overlay. */
export async function resolveObjectSet(args: ResolveArgs): Promise<Record<string, unknown>[]> {
  const db = await openDuckDb();
  try {
    await attachPostgres(db, args.pgConnString, 'pg');
    if (args.s3) await configureS3(db, args.s3);
    const { sql, params } = buildResolveSql(args.mapping, 'pg', args.options ?? {});
    return (await db.all(sql, ...params)) as Record<string, unknown>[];
  } finally {
    await db.close();
  }
}
```

- [ ] **Step 4: Export it — modify `packages/query/src/index.ts`**

Add:
```ts
export { resolveObjectSet, type ResolveArgs } from './resolver.js';
```

- [ ] **Step 5: Run the test to verify it passes**

Run:
```bash
pnpm --filter @so/query test resolver
```
Expected: PASS — all `resolveObjectSet` tests green. **This is the spike's core proof.**

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(query): resolveObjectSet merges parquet base with postgres overlay"
```

---

## Task 6: Resolve from object storage (MinIO via httpfs)

**Files:**
- Modify: `packages/query/test/fixtures.ts`, `packages/query/test/resolver.int.test.ts`

> Proves the real production path: the base dataset lives in S3-API object storage, not on local disk.

- [ ] **Step 1: Add an S3 upload helper — append to `packages/query/test/fixtures.ts`**

```ts
import { openDuckDb, configureS3 } from '../src/index.js';
import type { S3Options } from '../src/index.js';

export const TEST_S3: S3Options = {
  endpoint: process.env.S3_ENDPOINT ?? 'localhost:9000',
  accessKeyId: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin',
  region: 'us-east-1',
  useSsl: false,
};

/** Copies a local parquet fixture into MinIO and returns its s3:// URI. */
export async function uploadFixtureToS3(localPath: string): Promise<string> {
  const bucket = process.env.S3_BUCKET ?? 'so-datasets';
  const uri = `s3://${bucket}/flights.parquet`;
  const db = await openDuckDb();
  try {
    await configureS3(db, TEST_S3);
    await db.all(`COPY (SELECT * FROM read_parquet('${localPath}')) TO '${uri}' (FORMAT parquet)`);
  } finally {
    await db.close();
  }
  return uri;
}
```

- [ ] **Step 2: Add the failing test — append to `packages/query/test/resolver.int.test.ts`**

```ts
import { uploadFixtureToS3, TEST_S3 } from './fixtures.js';

describe('resolveObjectSet (S3 backing)', () => {
  it('resolves from MinIO and still applies the overlay', async () => {
    const s3Uri = await uploadFixtureToS3(parquetPath);
    const mapping = flightMapping(parquetPath);
    mapping.backing = { kind: 's3', path: s3Uri };

    const rows = await resolveObjectSet({
      mapping,
      pgConnString: PG,
      s3: TEST_S3,
      options: { filters: [{ property: 'flightNumber', op: '=', value: 'FL-204' }] },
    });
    expect(rows[0]?.status).toBe('Delayed');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails (then passes once infra is reachable)**

Run:
```bash
pnpm --filter @so/query test resolver
```
Expected: this S3 test FAILS first only if MinIO is unreachable; with `infra:up` healthy and the bucket created, **it passes** — `resolveObjectSet` needs no code change because `read_parquet('s3://...')` is handled by `configureS3` + the generated SQL. This task is a proof, not new production code.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test(query): prove resolution from MinIO/S3 object storage"
```

---

## Task 7: CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request:

jobs:
  build-test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env: { POSTGRES_USER: so, POSTGRES_PASSWORD: so, POSTGRES_DB: so }
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U so -d so" --health-interval 2s
          --health-timeout 3s --health-retries 20
      minio:
        image: bitnami/minio:latest
        env:
          MINIO_ROOT_USER: minioadmin
          MINIO_ROOT_PASSWORD: minioadmin
          MINIO_DEFAULT_BUCKETS: so-datasets
        ports: ['9000:9000']
    env:
      DATABASE_URL: postgresql://so:so@localhost:5432/so
      S3_ENDPOINT: localhost:9000
      S3_ACCESS_KEY_ID: minioadmin
      S3_SECRET_ACCESS_KEY: minioadmin
      S3_BUCKET: so-datasets
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10.28.1 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/seed-overlay.sql
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test
```

- [ ] **Step 2: Verify the full suite locally before relying on CI**

Run:
```bash
pnpm run infra:up && pnpm run infra:seed
pnpm typecheck && pnpm lint && pnpm test
```
Expected: typecheck clean, lint clean, all `@so/query` tests PASS.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "ci: typecheck + lint + test with postgres and minio services"
```

---

## Done criteria for Plan 1

- `pnpm install` resolves the workspace; `pnpm typecheck` / `pnpm lint` clean.
- `docker compose up -d --wait` brings Postgres + MinIO healthy; bucket `so-datasets` exists.
- `@so/query` exposes `resolveObjectSet()` proving, with passing tests: overlay edits override base values, created objects appear, unedited rows pass through, and resolution works against **both** local Parquet and MinIO/S3.
- CI runs the same suite against service containers.

The riskiest mechanism in the system (spec §14) is now proven and reusable. Plan 2 (Kernel & SDK) builds the module framework that will consume `@so/query`.

---

## Self-review (completed against the spec)

- **Spec §7 (resolution model)** — Tasks 4–6 implement EAV-overlay merge + created-object union via DuckDB; the immutable-base + Postgres-overlay design is exactly modeled. ✓
- **Spec §3/§9 (stack, portability)** — DuckDB in-process, Postgres, S3-API object store via MinIO; Task 6 proves the S3 path that makes MinIO⇄S3 a config swap. ✓
- **Spec §8 (NFRs)** — TS strict + `noUncheckedIndexedAccess`; tests at unit (sql) + integration (resolver) levels; CI gate; SQL-injection guard on identifiers/operators; parameterized filter values. ✓
- **Placeholder scan** — no TBD/TODO; every code step contains complete code. ✓
- **Type consistency** — `ObjectTypeMapping`, `PropertyMapping`, `Filter`, `ResolveOptions`, `S3Options` defined once in `types.ts` and used unchanged in `sql.ts`, `resolver.ts`, and tests; `openDuckDb`/`attachPostgres`/`configureS3`/`buildResolveSql`/`resolveObjectSet` signatures match call sites. ✓
- **Deliberately deferred (correct for a spike, owned by later plans):** typed coercion of overlay values lives in `module-ontology` (Plan 6); extension pinning for air-gap in Phase 2; cursor pagination (this uses limit/offset) in `module-explorer` (Plan 8). Flagged, not silently dropped.
```
