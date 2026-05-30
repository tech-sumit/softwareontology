# Phase 25 (#1) — Airflow Connector Reuse Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps `- [ ]`.

**Goal:** Reuse Airflow's provider ecosystem for connectivity. A TS `@so/connectors-airflow` module stores connector specs and, on sync, calls an external **`connector-runner`** (Python) over HTTP; the runner uses an **Airflow provider Hook** to extract data and returns rows, which we ingest as a dataset. New providers = `pip install apache-airflow-providers-<x>` + a dispatch case.

**Architecture (decided):** Do NOT run Airflow's scheduler — we have our own (worker). The runner is a thin **FastAPI sidecar** exposing `POST /extract {provider, conn, query} → {rows}`. The TS module is fully testable in the Node suite via a **stub runner** (a local HTTP server with the exact contract). The Python runner is delivered with `requirements.txt`, `Dockerfile`, `README`, and a `pytest`; its real-Airflow path is verified best-effort (heavy `apache-airflow` install).

> **Honesty:** rows-as-JSON over HTTP is fine for moderate volumes; a production runner writes Parquet to object storage directly for scale (noted, deferred). Air-gap: vendor the provider wheels.

---

## Pre-flight
- [ ] **Branch:** `git checkout main && git checkout -b phase25/airflow-connectors`

---

## Task 1: `@so/connectors-airflow` (TS module — the green-suite deliverable)

**Files:** Create `packages/connectors-airflow/{package.json,tsconfig.json,vitest.config.ts,src/migrate.ts,src/service.ts,src/routes.ts,src/index.ts,test/connectors-airflow.int.test.ts}`

- [ ] **Step 1: `packages/connectors-airflow/package.json`**
```json
{
  "name": "@so/connectors-airflow", "version": "0.0.0", "private": true, "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "dependencies": { "@so/sdk": "workspace:*", "@so/auth": "workspace:*", "fastify": "^5.2.0" },
  "devDependencies": { "@so/server": "workspace:*", "@so/observability": "workspace:*", "@so/datasets": "workspace:*", "@types/node": "^22.10.0", "@types/pg": "^8.11.0" }
}
```

- [ ] **Step 2: `pnpm install`**

- [ ] **Step 3: `packages/connectors-airflow/tsconfig.json`**
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "outDir": "dist", "types": ["node"] }, "include": ["src/**/*", "test/**/*"] }
```

- [ ] **Step 4: `packages/connectors-airflow/vitest.config.ts`**
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { testTimeout: 60_000, hookTimeout: 60_000 } });
```

- [ ] **Step 5: `packages/connectors-airflow/src/migrate.ts`**
```ts
import type { Db } from '@so/sdk';
export async function runMigrations(db: Db): Promise<void> {
  await db.query(`CREATE TABLE IF NOT EXISTS airflow_connectors (
    id text PRIMARY KEY, org_id text NOT NULL, name text NOT NULL,
    provider text NOT NULL, conn text NOT NULL, query text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (org_id, name)
  )`);
}
```

- [ ] **Step 6: `packages/connectors-airflow/src/service.ts`**
```ts
import { randomUUID } from 'node:crypto';
import { writeFile, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModuleContext } from '@so/sdk';

const NAME_RE = /^[A-Za-z0-9_-]+$/;

export interface AirflowConnectorInput { name: string; provider: string; conn: string; query: string; }

export function createAirflowConnectorService(ctx: ModuleContext) {
  function runnerUrl(): string { return ctx.config.get('CONNECTOR_RUNNER_URL') ?? 'http://localhost:8077'; }

  async function createConnector(orgId: string, input: AirflowConnectorInput): Promise<string> {
    if (!NAME_RE.test(input.name)) throw new Error('invalid connector name');
    if (!input.provider || !input.conn || !input.query) throw new Error('provider, conn, query required');
    const id = randomUUID();
    await ctx.db.query(`INSERT INTO airflow_connectors(id,org_id,name,provider,conn,query) VALUES ($1,$2,$3,$4,$5,$6)`, [id, orgId, input.name, input.provider, input.conn, input.query]);
    return id;
  }

  async function listConnectors(orgId: string): Promise<Array<{ id: string; name: string; provider: string }>> {
    const rows = await ctx.db.query<{ id: string; name: string; provider: string }>(`SELECT id, name, provider FROM airflow_connectors WHERE org_id = $1 ORDER BY name`, [orgId]);
    return rows.map((r) => ({ id: r.id, name: r.name, provider: r.provider }));
  }

  async function sync(orgId: string, id: string): Promise<{ datasetId: string; rowCount: number }> {
    const rows = await ctx.db.query<{ name: string; provider: string; conn: string; query: string }>(`SELECT name, provider, conn, query FROM airflow_connectors WHERE org_id = $1 AND id = $2`, [orgId, id]);
    const c = rows[0];
    if (!c) throw new Error('connector not found');
    const res = await fetch(`${runnerUrl()}/extract`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: c.provider, conn: c.conn, query: c.query }) });
    if (!res.ok) throw new Error(`connector-runner error: ${res.status}`);
    const data = (await res.json()) as { rows?: unknown };
    if (!Array.isArray(data.rows)) throw new Error('runner did not return rows[]');

    const datasetId = randomUUID();
    const objectKey = `${orgId}/datasets/${datasetId}/data.parquet`;
    const s3out = ctx.objectStore.getObjectUrl(objectKey);
    const dir = await mkdtemp(join(tmpdir(), 'so-airflow-'));
    const file = join(dir, 'data.json');
    await writeFile(file, JSON.stringify(data.rows));
    const session = await ctx.query.open();
    try {
      await session.all(`CREATE TEMP TABLE _ingest AS SELECT * FROM read_json_auto('${file}')`);
      const described = await session.all(`DESCRIBE _ingest`);
      const counted = await session.all(`SELECT count(*)::int AS n FROM _ingest`);
      await session.all(`COPY _ingest TO '${s3out}' (FORMAT parquet)`);
      const rowCount = Number(counted[0]?.n ?? 0);
      await ctx.db.query(`INSERT INTO datasets(id,org_id,name,object_key,row_count) VALUES ($1,$2,$3,$4,$5)`, [datasetId, orgId, c.name, objectKey, rowCount]);
      for (let i = 0; i < described.length; i++) { const col = described[i]!; await ctx.db.query(`INSERT INTO dataset_columns(dataset_id,ordinal,name,duck_type) VALUES ($1,$2,$3,$4)`, [datasetId, i, String(col.column_name), String(col.column_type)]); }
      return { datasetId, rowCount };
    } finally { await session.close(); await rm(dir, { recursive: true, force: true }); }
  }

  return { createConnector, listConnectors, sync };
}
```

- [ ] **Step 7: `packages/connectors-airflow/src/routes.ts`**
```ts
import type { FastifyPluginAsync } from 'fastify';
import { requirePermission } from '@so/auth';
import { createAirflowConnectorService, type AirflowConnectorInput } from './service.js';

export const airflowConnectorRoutes: FastifyPluginAsync = async (fastify) => {
  const svc = createAirflowConnectorService(fastify.ctx);
  fastify.post('/', { preHandler: requirePermission('connectors:write') }, async (req, reply) => {
    const b = req.body as Partial<AirflowConnectorInput>;
    if (!b?.name || !b?.provider || !b?.conn || !b?.query) return reply.code(400).send({ error: 'name, provider, conn, query required' });
    try { return reply.code(201).send({ id: await svc.createConnector(req.user!.orgId, b as AirflowConnectorInput) }); }
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

- [ ] **Step 8: `packages/connectors-airflow/src/index.ts`**
```ts
import { defineModule } from '@so/sdk';
import { runMigrations } from './migrate.js';
import { airflowConnectorRoutes } from './routes.js';

export default defineModule({
  id: 'connectors-airflow',
  dependsOn: ['datasets', 'auth'],
  contributes: { apiRoutes: airflowConnectorRoutes, permissions: ['connectors:read', 'connectors:write'] },
  async onInstall(ctx) { await runMigrations(ctx.db); },
});

export { createAirflowConnectorService, type AirflowConnectorInput } from './service.js';
```

- [ ] **Step 9: `packages/connectors-airflow/test/connectors-airflow.int.test.ts`** (stub runner — exact contract the Python runner implements)
```ts
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { createServer as createHttp, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createServer, createConfig, type AppServer } from '@so/server';
import { createLogger } from '@so/observability';
import authModule from '@so/auth';
import datasetsModule from '@so/datasets';
import airflowModule from '../src/index.js';

let runner: Server; let runnerPort = 0;
beforeAll(async () => {
  runner = createHttp((req, res) => {
    let body = ''; req.on('data', (c) => { body += c; });
    req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ rows: [{ id: 1, label: 'alpha' }, { id: 2, label: 'beta' }] })); });
  });
  await new Promise<void>((r) => runner.listen(0, r)); runnerPort = (runner.address() as AddressInfo).port;
});
afterAll(async () => { await server?.stop(); await new Promise<void>((r) => runner.close(() => r())); });
function cookieFrom(s: string | string[] | undefined): string { const raw = Array.isArray(s) ? s[0]! : s!; return raw.split(';')[0]!; }
let server: AppServer;

describe('airflow connector: drives the connector-runner', () => {
  it('syncs rows from the runner into a dataset', async () => {
    const config = createConfig({
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so',
      S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'localhost:9000', S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
      S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin', S3_BUCKET: process.env.S3_BUCKET ?? 'so-datasets',
      ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: 'admin', CONNECTOR_RUNNER_URL: `http://localhost:${runnerPort}`,
    });
    server = await createServer({ modules: [authModule, datasetsModule, airflowModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();
    await server.kernel.ctx.db.query(`DELETE FROM airflow_connectors WHERE name='afconn'`);

    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const a = { cookie: cookieFrom(login.headers['set-cookie']) };
    const create = await server.app.inject({ method: 'POST', url: '/api/connectors-airflow', headers: a, payload: { name: 'afconn', provider: 'postgres', conn: 'postgresql://x', query: 'SELECT 1' } });
    expect(create.statusCode).toBe(201);
    const sync = await server.app.inject({ method: 'POST', url: `/api/connectors-airflow/${create.json().id}/sync`, headers: a });
    expect(sync.json().rowCount).toBe(2);
    const preview = await server.app.inject({ method: 'GET', url: `/api/datasets/${sync.json().datasetId}/preview`, headers: a });
    expect((preview.json().rows as Array<{ label: string }>).map((r) => r.label).sort()).toEqual(['alpha', 'beta']);
  });
});
```

- [ ] **Step 10: Run → PASS:** `pnpm run infra:up && pnpm --filter @so/connectors-airflow test` (timeout 180000). typecheck clean; no unused imports.

- [ ] **Step 11: Commit:** `git add -A && git commit -m "feat(connectors-airflow): TS module driving a connector-runner sidecar"`

---

## Task 2: `connector-runner` (Python sidecar — real Airflow Hook)

**Files:** Create `services/connector-runner/{main.py,requirements.txt,Dockerfile,README.md,test_extract.py}`

- [ ] **Step 1: `services/connector-runner/main.py`**
```python
"""Connector-runner: extract via Airflow provider Hooks, return rows as JSON.

POST /extract {provider, conn, query} -> {rows: [...]}
New sources: pip install apache-airflow-providers-<x> + add a dispatch branch.
"""
import os
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="connector-runner")


class ExtractReq(BaseModel):
    provider: str
    conn: str
    query: str


def _postgres_rows(conn: str, query: str):
    # Reuse Airflow's Postgres provider Hook (its connection model + impl).
    os.environ["AIRFLOW_CONN_DYNAMIC"] = conn
    from airflow.providers.postgres.hooks.postgres import PostgresHook  # type: ignore
    hook = PostgresHook(postgres_conn_id="dynamic")
    df = hook.get_pandas_df(query)
    return df.to_dict(orient="records")


@app.post("/extract")
def extract(req: ExtractReq):
    if req.provider == "postgres":
        return {"rows": _postgres_rows(req.conn, req.query)}
    raise HTTPException(status_code=400, detail=f"unsupported provider: {req.provider}")


@app.get("/healthz")
def healthz():
    return {"status": "ok"}
```

- [ ] **Step 2: `services/connector-runner/requirements.txt`**
```
fastapi>=0.110
uvicorn>=0.29
pandas>=2.0
apache-airflow>=2.9
apache-airflow-providers-postgres>=5.10
```

- [ ] **Step 3: `services/connector-runner/Dockerfile`**
```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY main.py .
EXPOSE 8077
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8077"]
```

- [ ] **Step 4: `services/connector-runner/test_extract.py`**
```python
import os
import pytest

PG = os.environ.get("DATABASE_URL", "postgresql://so:so@localhost:5432/so")


def test_postgres_extract():
    from main import _postgres_rows
    rows = _postgres_rows(PG, "SELECT 1 AS id, 'alpha' AS label")
    assert rows == [{"id": 1, "label": "alpha"}]
```

- [ ] **Step 5: `services/connector-runner/README.md`** — brief: what it is, `pip install -r requirements.txt`, `uvicorn main:app --port 8077`, set `CONNECTOR_RUNNER_URL` for the platform, add providers via pip + a dispatch branch, air-gap = vendor wheels.

- [ ] **Step 6: Best-effort verify (do NOT block on a heavy airflow install):**
  - `python3 -m py_compile services/connector-runner/main.py services/connector-runner/test_extract.py` → must pass (syntax).
  - Attempt `python3 -m venv /tmp/cr && /tmp/cr/bin/pip install -r services/connector-runner/requirements.txt` ONLY if it completes in a few minutes; if so, run `DATABASE_URL=postgresql://so:so@localhost:5432/so /tmp/cr/bin/python -m pytest services/connector-runner/test_extract.py`. If the install is too slow/fails in this environment, SKIP it and note that the runner is delivered for the user's Python env (the TS module's stub test proves the contract).

- [ ] **Step 7: Commit:** `git add -A && git commit -m "feat(connector-runner): Python sidecar using Airflow Postgres Hook"`

---

## Task 3: Full verification + merge
- [ ] `pnpm run infra:up && pnpm run infra:seed && pnpm typecheck; pnpm lint; pnpm test` (exit codes) → green (the Node suite must be green; the Python runner is not part of `pnpm test`). `services/` is not a pnpm workspace, so it won't affect the Node build/lint/test. Then `git checkout main && git merge --ff-only phase25/airflow-connectors`.

---

## Self-review
- **Spec §6 / user #1 (Airflow ecosystem)** — connectivity via Airflow provider Hooks, driven by our own scheduler (not Airflow's), through a thin runner sidecar; new providers by pip + dispatch. ✓
- **Testable + green** — TS module fully tested in the Node suite against a stub with the exact runner contract; Python runner has its own pytest (best-effort run here). ✓
- **Honest** — rows-as-JSON for moderate volume (production writes Parquet directly at scale); heavy airflow install is a deployment concern; air-gap = vendored wheels. Flagged.
- **Deferred:** Parquet-direct extraction for scale, more providers wired, runner auth, scheduled syncs via the worker, secrets for `conn`. Flagged.
