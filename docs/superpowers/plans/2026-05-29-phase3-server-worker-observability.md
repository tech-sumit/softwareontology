# Phase 3 — Server, Worker & Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the framework into a running system: provide the real `ctx` services the kernel injects (`db`, `objectStore`, `query`, `config`, `log`), a **Fastify** HTTP host that mounts module API routes and exposes health probes, and a **pg-boss** worker that runs module jobs.

**Architecture:** `@so/observability` provides a pino-backed `Logger`. `@so/server` provides `createConfig` (12-factor env), service factories (`createDb` over `pg`, `createObjectStore` over the S3 API, `createQueryEngine` over `@so/query`'s DuckDB), and `createServer({ modules })` which builds `ctx`, creates the kernel, decorates Fastify with `ctx`, mounts each module's `apiRoutes` plugin under `/api/<id>`, and serves `/healthz` + `/readyz`. `@so/worker` builds the same `ctx`, starts the kernel, and binds each contributed job to pg-boss.

**Tech Stack:** Fastify 5, pino 9, pg 8, @aws-sdk/client-s3 3, pg-boss 10, consuming `@so/sdk` / `@so/kernel` / `@so/query` via `workspace:*`. Integration tests run against the existing Docker Postgres + MinIO.

**Out of scope (deferred):** OpenTelemetry traces/metrics exporters and auto-instrumentation (dedicated observability-hardening task in Phase 2 roadmap). Structured logging + health probes land here.

---

## Pre-flight

- [ ] **Branch from main:**

```bash
cd /Users/sumitagrawal/CODE/sumit/SoftwareOntology
git checkout main && git checkout -b phase3/server-worker-observability
```

---

## File structure

```
packages/observability/
  package.json            @so/observability (dep: @so/sdk, pino)
  tsconfig.json
  src/logger.ts           createLogger(): pino -> Logger
  src/index.ts
  test/logger.test.ts
packages/server/
  package.json            @so/server (deps: @so/sdk @so/kernel @so/query @so/observability, fastify pg @aws-sdk/client-s3)
  tsconfig.json
  src/config.ts           createConfig(env): Config
  src/services/db.ts      createDb(config): DbService (pg Pool)
  src/services/object-store.ts  createObjectStore(config): ObjectStoreService (S3)
  src/services/query-engine.ts  createQueryEngine(config): QueryEngine (DuckDB via @so/query)
  src/server.ts           createServer({modules,logger,config?}): AppServer
  src/index.ts
  test/services.int.test.ts
  test/server.int.test.ts
packages/worker/
  package.json            @so/worker (deps: @so/sdk @so/kernel @so/server, pg-boss)
  tsconfig.json
  src/worker.ts           createWorker({modules,logger,config?}): Worker
  src/index.ts
  test/worker.int.test.ts
```

---

## Task 1: `@so/observability` — structured logger

**Files:** Create `packages/observability/{package.json,tsconfig.json,src/logger.ts,src/index.ts,test/logger.test.ts}`

- [ ] **Step 1: Create `packages/observability/package.json`**

```json
{
  "name": "@so/observability",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "dependencies": { "@so/sdk": "workspace:*", "pino": "^9.6.0" },
  "devDependencies": { "@types/node": "^22.10.0" }
}
```

- [ ] **Step 2: `pnpm install`** — Expected: completes, links `@so/observability`.

- [ ] **Step 3: Create `packages/observability/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "types": ["node"] },
  "include": ["src/**/*", "test/**/*"]
}
```

- [ ] **Step 4: Write `packages/observability/test/logger.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import { createLogger } from '../src/logger.js';

function collector() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) { lines.push(chunk.toString()); cb(); },
  });
  return { lines, stream };
}

describe('createLogger', () => {
  it('emits structured JSON with message and metadata', () => {
    const { lines, stream } = collector();
    const log = createLogger({ level: 'debug' }, stream);
    log.info('hello', { a: 1 });
    const rec = JSON.parse(lines[0]!);
    expect(rec.msg).toBe('hello');
    expect(rec.a).toBe(1);
  });

  it('child loggers carry bindings', () => {
    const { lines, stream } = collector();
    const log = createLogger({ level: 'debug' }, stream);
    log.child({ mod: 'ontology' }).warn('careful');
    const rec = JSON.parse(lines[0]!);
    expect(rec.mod).toBe('ontology');
    expect(rec.msg).toBe('careful');
  });
});
```

- [ ] **Step 5: Run → FAIL** (`Cannot find module '../src/logger.js'`): `pnpm --filter @so/observability test`

- [ ] **Step 6: Create `packages/observability/src/logger.ts`**

```ts
import pino, { type Logger as PinoLogger, type DestinationStream } from 'pino';
import type { Logger } from '@so/sdk';

function wrap(p: PinoLogger): Logger {
  return {
    debug: (msg, meta) => p.debug(meta ?? {}, msg),
    info: (msg, meta) => p.info(meta ?? {}, msg),
    warn: (msg, meta) => p.warn(meta ?? {}, msg),
    error: (msg, meta) => p.error(meta ?? {}, msg),
    child: (bindings) => wrap(p.child(bindings)),
  };
}

export function createLogger(
  opts: { level?: string; name?: string } = {},
  stream?: DestinationStream,
): Logger {
  const options = { level: opts.level ?? 'info', name: opts.name ?? 'so' };
  return wrap(stream ? pino(options, stream) : pino(options));
}
```

- [ ] **Step 7: Create `packages/observability/src/index.ts`**

```ts
export { createLogger } from './logger.js';
```

- [ ] **Step 8: Run → PASS (2 tests)**, then `pnpm --filter @so/observability run typecheck` (clean).

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat(observability): pino-backed structured Logger"
```

---

## Task 2: `@so/server` — config + ctx service factories

**Files:** Create `packages/server/{package.json,tsconfig.json,src/config.ts,src/services/db.ts,src/services/object-store.ts,src/services/query-engine.ts,test/services.int.test.ts}`

> Integration tests require infra: `pnpm run infra:up && pnpm run infra:seed`.

- [ ] **Step 1: Create `packages/server/package.json`**

```json
{
  "name": "@so/server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "dependencies": {
    "@so/sdk": "workspace:*",
    "@so/kernel": "workspace:*",
    "@so/query": "workspace:*",
    "@so/observability": "workspace:*",
    "fastify": "^5.2.0",
    "pg": "^8.13.0",
    "@aws-sdk/client-s3": "^3.700.0"
  },
  "devDependencies": { "@types/node": "^22.10.0", "@types/pg": "^8.11.0" }
}
```

- [ ] **Step 2: `pnpm install`** — Expected: completes; fastify/pg/@aws-sdk present.

- [ ] **Step 3: Create `packages/server/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "types": ["node"] },
  "include": ["src/**/*", "test/**/*"]
}
```

- [ ] **Step 4: Create `packages/server/src/config.ts`**

```ts
import type { Config } from '@so/sdk';

export function createConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    get: (key) => env[key],
    require: (key) => {
      const v = env[key];
      if (v === undefined || v === '') throw new Error(`Missing required config: ${key}`);
      return v;
    },
  };
}
```

- [ ] **Step 5: Create `packages/server/src/services/db.ts`**

```ts
import { Pool } from 'pg';
import type { Db, Config } from '@so/sdk';

export interface DbService extends Db {
  pool: Pool;
  close(): Promise<void>;
}

export function createDb(config: Config): DbService {
  const pool = new Pool({ connectionString: config.require('DATABASE_URL') });
  return {
    pool,
    async query<R = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<R[]> {
      const res = await pool.query(sql, params as unknown[] | undefined);
      return res.rows as R[];
    },
    async close() { await pool.end(); },
  };
}
```

- [ ] **Step 6: Create `packages/server/src/services/object-store.ts`**

```ts
import { S3Client, PutObjectCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import type { ObjectStore, Config } from '@so/sdk';

export interface ObjectStoreService extends ObjectStore {
  client: S3Client;
  bucket: string;
  ping(): Promise<void>;
}

export function createObjectStore(config: Config): ObjectStoreService {
  const bucket = config.require('S3_BUCKET');
  const useSsl = config.get('S3_USE_SSL') === 'true';
  const client = new S3Client({
    endpoint: `${useSsl ? 'https' : 'http'}://${config.require('S3_ENDPOINT')}`,
    region: config.get('S3_REGION') ?? 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.require('S3_ACCESS_KEY_ID'),
      secretAccessKey: config.require('S3_SECRET_ACCESS_KEY'),
    },
  });
  return {
    client,
    bucket,
    async putObject(key, body) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body }));
    },
    getObjectUrl(key) { return `s3://${bucket}/${key}`; },
    async ping() { await client.send(new HeadBucketCommand({ Bucket: bucket })); },
  };
}
```

- [ ] **Step 7: Create `packages/server/src/services/query-engine.ts`**

```ts
import { openDuckDb, attachPostgres, configureS3 } from '@so/query';
import type { QueryEngine, Config } from '@so/sdk';

export function createQueryEngine(config: Config): QueryEngine {
  return {
    async open() {
      const db = await openDuckDb();
      await attachPostgres(db, config.require('DATABASE_URL'), 'pg');
      await configureS3(db, {
        endpoint: config.require('S3_ENDPOINT'),
        accessKeyId: config.require('S3_ACCESS_KEY_ID'),
        secretAccessKey: config.require('S3_SECRET_ACCESS_KEY'),
        region: config.get('S3_REGION') ?? 'us-east-1',
        useSsl: config.get('S3_USE_SSL') === 'true',
      });
      return {
        all: (sql: string, ...params: unknown[]) =>
          db.all(sql, ...params) as Promise<Record<string, unknown>[]>,
        close: () => db.close(),
      };
    },
  };
}
```

- [ ] **Step 8: Write `packages/server/test/services.int.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createConfig } from '../src/config.js';
import { createDb, type DbService } from '../src/services/db.js';
import { createObjectStore } from '../src/services/object-store.js';
import { createQueryEngine } from '../src/services/query-engine.js';

const config = createConfig({
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so',
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'localhost:9000',
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin',
  S3_BUCKET: process.env.S3_BUCKET ?? 'so-datasets',
});

let db: DbService;
beforeAll(() => { db = createDb(config); });
afterAll(async () => { await db.close(); });

describe('service factories', () => {
  it('db runs a query', async () => {
    const rows = await db.query<{ n: number }>('SELECT 1::int AS n');
    expect(rows[0]?.n).toBe(1);
  });

  it('object store reaches the bucket and builds s3 urls', async () => {
    const os = createObjectStore(config);
    await os.ping(); // throws if bucket unreachable
    expect(os.getObjectUrl('a/b.parquet')).toBe('s3://so-datasets/a/b.parquet');
  });

  it('query engine opens a session with postgres attached', async () => {
    const qe = createQueryEngine(config);
    const session = await qe.open();
    try {
      const rows = await session.all("SELECT count(*)::int AS n FROM pg.public.object_writeback");
      expect(typeof rows[0]?.n).toBe('number');
    } finally {
      await session.close();
    }
  });
});
```

- [ ] **Step 9: Run with infra up → PASS (3 tests)**

```bash
pnpm run infra:up && pnpm run infra:seed
pnpm --filter @so/server test services
```
(Set Bash timeout 180000.) Then `pnpm --filter @so/server run typecheck` (clean).

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "feat(server): config + db/objectStore/queryEngine ctx services"
```

---

## Task 3: `@so/server` — Fastify app with health + module routes

**Files:** Create `packages/server/src/server.ts`, `packages/server/src/index.ts`, `packages/server/test/server.int.test.ts`

- [ ] **Step 1: Write `packages/server/test/server.int.test.ts`**

```ts
import { describe, it, expect, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { defineModule } from '@so/sdk';
import { createLogger } from '@so/observability';
import { createServer, type AppServer } from '../src/server.js';
import { createConfig } from '../src/config.js';

const config = createConfig({
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so',
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'localhost:9000',
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin',
  S3_BUCKET: process.env.S3_BUCKET ?? 'so-datasets',
});

const pingModule = defineModule({
  id: 'ping',
  contributes: {
    apiRoutes: async (fastify: FastifyInstance) => {
      fastify.get('/ping', async () => ({ pong: typeof fastify.ctx.config.get === 'function' }));
    },
  },
});

let server: AppServer;
afterAll(async () => { await server?.stop(); });

describe('createServer', () => {
  it('serves health, readiness, and mounted module routes', async () => {
    server = await createServer({ modules: [pingModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();

    const health = await server.app.inject({ method: 'GET', url: '/healthz' });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: 'ok' });

    const ready = await server.app.inject({ method: 'GET', url: '/readyz' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({ status: 'ready' });

    const ping = await server.app.inject({ method: 'GET', url: '/api/ping/ping' });
    expect(ping.statusCode).toBe(200);
    expect(ping.json()).toEqual({ pong: true });
  });
});
```

- [ ] **Step 2: Run → FAIL** (`Cannot find module '../src/server.js'`): `pnpm --filter @so/server test server`

- [ ] **Step 3: Create `packages/server/src/server.ts`**

```ts
import Fastify, { type FastifyInstance, type FastifyPluginAsync } from 'fastify';
import type { ModuleDefinition, ModuleContext, Config, Logger } from '@so/sdk';
import { createKernel, type Kernel } from '@so/kernel';
import { createConfig } from './config.js';
import { createDb, type DbService } from './services/db.js';
import { createObjectStore } from './services/object-store.js';
import { createQueryEngine } from './services/query-engine.js';

declare module 'fastify' {
  interface FastifyInstance {
    ctx: ModuleContext;
  }
}

export interface AppServer {
  app: FastifyInstance;
  kernel: Kernel;
  start(port?: number): Promise<string>;
  stop(): Promise<void>;
}

export async function createServer(opts: {
  modules: ModuleDefinition[];
  logger: Logger;
  config?: Config;
}): Promise<AppServer> {
  const config = opts.config ?? createConfig();
  const db: DbService = createDb(config);
  const objectStore = createObjectStore(config);
  const query = createQueryEngine(config);

  const kernel = createKernel({
    modules: opts.modules,
    services: { db, objectStore, query, config, log: opts.logger },
  });

  const app = Fastify({ logger: false });
  app.decorate('ctx', kernel.ctx);

  app.get('/healthz', async () => ({ status: 'ok' }));
  app.get('/readyz', async (_req, reply) => {
    try {
      await db.query('SELECT 1');
      return { status: 'ready' };
    } catch {
      return reply.code(503).send({ status: 'unavailable' });
    }
  });

  for (const m of opts.modules) {
    const routes = m.contributes?.apiRoutes as FastifyPluginAsync | undefined;
    if (routes) await app.register(routes, { prefix: `/api/${m.id}` });
  }

  app.setErrorHandler((err, _req, reply) => {
    opts.logger.error('request error', { err: err.message, statusCode: err.statusCode });
    void reply.code(err.statusCode ?? 500).send({ error: err.message });
  });

  return {
    app,
    kernel,
    async start(port = Number(config.get('PORT') ?? 3000)) {
      await kernel.start();
      return app.listen({ port, host: '0.0.0.0' });
    },
    async stop() {
      await app.close();
      await kernel.stop();
      await db.close();
    },
  };
}
```

- [ ] **Step 4: Create `packages/server/src/index.ts`**

```ts
export { createServer, type AppServer } from './server.js';
export { createConfig } from './config.js';
export { createDb, type DbService } from './services/db.js';
export { createObjectStore, type ObjectStoreService } from './services/object-store.js';
export { createQueryEngine } from './services/query-engine.js';
```

- [ ] **Step 5: Run with infra up → PASS**

```bash
pnpm --filter @so/server test
```
Expected: services (3) + server (1) all pass. Then `pnpm --filter @so/server run typecheck` (clean).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(server): Fastify host — ctx decoration, health probes, module route mounting"
```

---

## Task 4: `@so/worker` — pg-boss job runner

**Files:** Create `packages/worker/{package.json,tsconfig.json,src/worker.ts,src/index.ts,test/worker.int.test.ts}`

- [ ] **Step 1: Create `packages/worker/package.json`**

```json
{
  "name": "@so/worker",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "dependencies": {
    "@so/sdk": "workspace:*",
    "@so/kernel": "workspace:*",
    "@so/server": "workspace:*",
    "pg-boss": "^10.1.5"
  },
  "devDependencies": { "@types/node": "^22.10.0" }
}
```

- [ ] **Step 2: `pnpm install`** — Expected: completes; pg-boss present.

- [ ] **Step 3: Create `packages/worker/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "types": ["node"] },
  "include": ["src/**/*", "test/**/*"]
}
```

- [ ] **Step 4: Write `packages/worker/test/worker.int.test.ts`**

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { defineModule } from '@so/sdk';
import { createLogger } from '@so/observability';
import { createConfig } from '@so/server';
import { createWorker, type Worker } from '../src/worker.js';

const config = createConfig({
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so',
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'localhost:9000',
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin',
  S3_BUCKET: process.env.S3_BUCKET ?? 'so-datasets',
});

let worker: Worker;
afterAll(async () => { await worker?.stop(); });

describe('createWorker', () => {
  it('runs a job contributed by a module', async () => {
    let resolveRan: (v: unknown) => void;
    const ran = new Promise((res) => { resolveRan = res; });

    const jobModule = defineModule({
      id: 'jobs-demo',
      contributes: {
        jobs: [{ name: 'demo.echo', handler: (_ctx, payload) => { resolveRan(payload); } }],
      },
    });

    worker = await createWorker({ modules: [jobModule], logger: createLogger(), config });
    await worker.start();
    await worker.enqueue('demo.echo', { hello: 'world' });

    const payload = await ran;
    expect(payload).toEqual({ hello: 'world' });
  });
});
```

- [ ] **Step 5: Run → FAIL** (`Cannot find module '../src/worker.js'`): `pnpm --filter @so/worker test`

- [ ] **Step 6: Create `packages/worker/src/worker.ts`**

```ts
import PgBoss from 'pg-boss';
import type { ModuleDefinition, ModuleContext, Config, Logger, JobDefinition } from '@so/sdk';
import { createKernel } from '@so/kernel';
import { createDb, createObjectStore, createQueryEngine } from '@so/server';

export interface Worker {
  start(): Promise<void>;
  enqueue(name: string, data: unknown): Promise<void>;
  stop(): Promise<void>;
}

export async function createWorker(opts: {
  modules: ModuleDefinition[];
  logger: Logger;
  config: Config;
}): Promise<Worker> {
  const { config, logger } = opts;
  const db = createDb(config);
  const objectStore = createObjectStore(config);
  const query = createQueryEngine(config);

  const kernel = createKernel({
    modules: opts.modules,
    services: { db, objectStore, query, config, log: logger },
  });
  const ctx: ModuleContext = kernel.ctx;

  const boss = new PgBoss(config.require('DATABASE_URL'));

  return {
    async start() {
      await kernel.start();
      await boss.start();
      const jobs = kernel.registry.get<JobDefinition>('jobs');
      for (const job of jobs) {
        await boss.createQueue(job.name);
        await boss.work(job.name, async (batch) => {
          for (const item of batch) await job.handler(ctx, item.data);
        });
        logger.info('job bound', { name: job.name });
      }
    },
    async enqueue(name, data) {
      await boss.send(name, data as object);
    },
    async stop() {
      await boss.stop({ graceful: false });
      await kernel.stop();
      await db.close();
    },
  };
}
```

- [ ] **Step 7: Create `packages/worker/src/index.ts`**

```ts
export { createWorker, type Worker } from './worker.js';
```

- [ ] **Step 8: Run with infra up → PASS (1 test)**

```bash
pnpm run infra:up
pnpm --filter @so/worker test
```
(Set Bash timeout 180000 — pg-boss creates its schema on first start.) Then `pnpm --filter @so/worker run typecheck` (clean).

> If pg-boss v10's `work` handler signature differs (batch array vs single job) or `createQueue` is required/absent, adjust to the installed version's API and report the exact change. The intent: bind `job.name` to `job.handler(ctx, data)` and have `enqueue` deliver to it.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat(worker): pg-boss job runner binding module-contributed jobs"
```

---

## Task 5: Full verification + merge

- [ ] **Step 1: Run the whole suite with infra up**

```bash
pnpm run infra:up && pnpm run infra:seed
pnpm typecheck && pnpm lint && pnpm test
```
Expected: typecheck + lint clean; all tests pass — `@so/query` (7), `@so/sdk` (4), `@so/kernel` (13), `@so/observability` (2), `@so/server` (4), `@so/worker` (1) = **31**.

- [ ] **Step 2: Commit any lint/format fixes if needed**, then the branch is ready to merge.

```bash
git add -A && git commit -m "chore: phase 3 full-suite green" || echo "nothing to commit"
```

---

## Done criteria

- `@so/observability` exports a pino-backed `Logger` (structured JSON, child bindings).
- `@so/server` exports `createConfig` + real `db`/`objectStore`/`query` services and `createServer` — Fastify with `/healthz`, `/readyz`, `ctx`-decorated, mounting module `apiRoutes` under `/api/<id>`.
- `@so/worker` runs module-contributed jobs via pg-boss.
- Full suite green (31 tests). The kernel now runs against real infrastructure; later module plans (auth, datasets, ontology, actions, explorer, admin) contribute routes/jobs into this host.

---

## Self-review (against the spec)

- **Spec §5 (foundation: server/worker/observability)** — all three packages delivered; `createServer` mounts `apiRoutes`, `createWorker` runs `jobs`, `@so/observability` provides the `Logger`. ✓
- **Spec §3 (architecture)** — real `ctx` services wire Postgres (`pg`), S3-API object store (`@aws-sdk/client-s3`, path-style for MinIO ⇄ S3), and in-process DuckDB (`@so/query`); modular monolith host. ✓
- **Spec §8 (NFRs)** — `/healthz`+`/readyz` (operability), structured logging (observability), error handler, strict TS, integration tests vs real infra. OTel traces explicitly deferred (noted in scope). ✓
- **Placeholder scan** — complete code in every step; the pg-boss API note is a version-adaptation instruction, not a placeholder. ✓
- **Type consistency** — `DbService`/`ObjectStoreService`/`AppServer`/`Worker` and `createConfig`/`createDb`/`createObjectStore`/`createQueryEngine`/`createServer`/`createWorker` signatures match all call sites; `FastifyInstance.ctx` augmentation declared once in `server.ts` and used by the test module. ✓
- **Deliberately deferred:** OTel exporters/instrumentation (dedicated task); per-request `ctx` child-logger + request-id correlation (can layer onto the error handler later); auth middleware (Plan 4 contributes it). Flagged, not silent.
```
