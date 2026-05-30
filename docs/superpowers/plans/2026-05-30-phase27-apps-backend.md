# Phase 27 (#4.1) — App Builder Backend (`@so/apps`) Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps `- [ ]`.

**Goal:** Backend for a Workshop-like app builder. Store **app definitions** — a named JSON layout of **widgets** (object-table, action-button, metric) bound to ontology object types / actions. CRUD + validation. The frontend builder/runtime (Plan 28) consumes this.

**Architecture:** New `@so/apps` module (pattern: `@so/pipelines`). `apps(id, org_id, name, definition jsonb)`. Definition = `{ widgets: [{ id, type, title?, config }] }`. Validation enforces known widget types + each type's required config keys. Loose coupling: stores JSON only (the runtime resolves objectType/action against the live ontology), so `dependsOn: ['auth']`.

---

## Pre-flight
- [ ] **Branch:** `git checkout main && git checkout -b phase27/apps-backend`

---

## Task 1: `@so/apps` module

**Files:** Create `packages/apps/{package.json,tsconfig.json,vitest.config.ts,src/migrate.ts,src/definition.ts,src/service.ts,src/routes.ts,src/index.ts,test/apps.int.test.ts}`

- [ ] **Step 1: `packages/apps/package.json`**
```json
{
  "name": "@so/apps", "version": "0.0.0", "private": true, "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "dependencies": { "@so/sdk": "workspace:*", "@so/auth": "workspace:*", "fastify": "^5.2.0" },
  "devDependencies": { "@so/server": "workspace:*", "@so/observability": "workspace:*", "@types/node": "^22.10.0" }
}
```

- [ ] **Step 2: `pnpm install`**

- [ ] **Step 3: `packages/apps/tsconfig.json`**
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "outDir": "dist", "types": ["node"] }, "include": ["src/**/*", "test/**/*"] }
```

- [ ] **Step 4: `packages/apps/vitest.config.ts`**
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { testTimeout: 60_000, hookTimeout: 60_000 } });
```

- [ ] **Step 5: `packages/apps/src/migrate.ts`**
```ts
import type { Db } from '@so/sdk';
export async function runMigrations(db: Db): Promise<void> {
  await db.query(`CREATE TABLE IF NOT EXISTS apps (
    id text PRIMARY KEY, org_id text NOT NULL, name text NOT NULL,
    definition jsonb NOT NULL DEFAULT '{"widgets":[]}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (org_id, name)
  )`);
}
```

- [ ] **Step 6: `packages/apps/src/definition.ts`** (validation — the heart)
```ts
export interface AppWidget { id: string; type: string; title?: string; config: Record<string, unknown>; }
export interface AppDefinition { widgets: AppWidget[]; }

const REQUIRED_CONFIG: Record<string, string[]> = {
  'object-table': ['objectType'],
  'action-button': ['action'],
  'metric': ['objectType'],
};

export function validateDefinition(input: unknown): AppDefinition {
  if (!input || typeof input !== 'object') throw new Error('definition must be an object');
  const widgets = (input as { widgets?: unknown }).widgets;
  if (!Array.isArray(widgets)) throw new Error('definition.widgets must be an array');
  const out: AppWidget[] = [];
  for (const w of widgets) {
    if (!w || typeof w !== 'object') throw new Error('each widget must be an object');
    const type = (w as { type?: unknown }).type;
    if (typeof type !== 'string' || !(type in REQUIRED_CONFIG)) throw new Error(`unknown widget type: ${String(type)}`);
    const id = (w as { id?: unknown }).id;
    if (typeof id !== 'string' || !id) throw new Error('each widget needs a string id');
    const config = ((w as { config?: unknown }).config ?? {}) as Record<string, unknown>;
    if (typeof config !== 'object') throw new Error('widget config must be an object');
    for (const key of REQUIRED_CONFIG[type]!) {
      if (!config[key]) throw new Error(`widget '${type}' requires config.${key}`);
    }
    const title = (w as { title?: unknown }).title;
    const widget: AppWidget = { id, type, config };
    if (typeof title === 'string') widget.title = title;
    out.push(widget);
  }
  return { widgets: out };
}
```

- [ ] **Step 7: `packages/apps/src/service.ts`**
```ts
import { randomUUID } from 'node:crypto';
import type { ModuleContext } from '@so/sdk';
import { validateDefinition, type AppDefinition } from './definition.js';

const NAME_RE = /^[A-Za-z0-9 _-]+$/;

export interface AppSummary { id: string; name: string; }
export interface AppRecord { id: string; name: string; definition: AppDefinition; }

export function createAppService(ctx: ModuleContext) {
  async function createApp(orgId: string, name: string, definition: unknown): Promise<string> {
    if (!name || !NAME_RE.test(name)) throw new Error('invalid app name');
    const def = validateDefinition(definition);
    const id = randomUUID();
    await ctx.db.query(`INSERT INTO apps(id,org_id,name,definition) VALUES ($1,$2,$3,$4)`, [id, orgId, name, JSON.stringify(def)]);
    return id;
  }
  async function listApps(orgId: string): Promise<AppSummary[]> {
    return ctx.db.query<AppSummary>(`SELECT id, name FROM apps WHERE org_id = $1 ORDER BY name`, [orgId]);
  }
  async function getApp(orgId: string, id: string): Promise<AppRecord | null> {
    const rows = await ctx.db.query<{ id: string; name: string; definition: AppDefinition }>(`SELECT id, name, definition FROM apps WHERE org_id = $1 AND id = $2`, [orgId, id]);
    const r = rows[0];
    return r ? { id: r.id, name: r.name, definition: r.definition } : null;
  }
  async function updateApp(orgId: string, id: string, patch: { name?: string; definition?: unknown }): Promise<boolean> {
    const existing = await getApp(orgId, id);
    if (!existing) return false;
    const name = patch.name ?? existing.name;
    if (!NAME_RE.test(name)) throw new Error('invalid app name');
    const def = patch.definition === undefined ? existing.definition : validateDefinition(patch.definition);
    await ctx.db.query(`UPDATE apps SET name=$1, definition=$2, updated_at=now() WHERE org_id=$3 AND id=$4`, [name, JSON.stringify(def), orgId, id]);
    return true;
  }
  async function deleteApp(orgId: string, id: string): Promise<boolean> {
    const rows = await ctx.db.query<{ id: string }>(`DELETE FROM apps WHERE org_id=$1 AND id=$2 RETURNING id`, [orgId, id]);
    return rows.length > 0;
  }
  return { createApp, listApps, getApp, updateApp, deleteApp };
}
```

- [ ] **Step 8: `packages/apps/src/routes.ts`**
```ts
import type { FastifyPluginAsync } from 'fastify';
import { requirePermission } from '@so/auth';
import { createAppService } from './service.js';

export const appRoutes: FastifyPluginAsync = async (fastify) => {
  const svc = createAppService(fastify.ctx);
  fastify.post('/', { preHandler: requirePermission('apps:write') }, async (req, reply) => {
    const b = req.body as { name?: string; definition?: unknown };
    if (!b?.name) return reply.code(400).send({ error: 'name required' });
    try { return reply.code(201).send({ id: await svc.createApp(req.user!.orgId, b.name, b.definition ?? { widgets: [] }) }); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });
  fastify.get('/', { preHandler: requirePermission('apps:read') }, async (req) => ({ apps: await svc.listApps(req.user!.orgId) }));
  fastify.get('/:id', { preHandler: requirePermission('apps:read') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const app = await svc.getApp(req.user!.orgId, id);
    return app ? reply.send(app) : reply.code(404).send({ error: 'app not found' });
  });
  fastify.put('/:id', { preHandler: requirePermission('apps:write') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = req.body as { name?: string; definition?: unknown };
    try { const ok = await svc.updateApp(req.user!.orgId, id, b); return ok ? reply.send({ ok: true }) : reply.code(404).send({ error: 'app not found' }); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });
  fastify.delete('/:id', { preHandler: requirePermission('apps:write') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const ok = await svc.deleteApp(req.user!.orgId, id);
    return ok ? reply.send({ ok: true }) : reply.code(404).send({ error: 'app not found' });
  });
};
```

- [ ] **Step 9: `packages/apps/src/index.ts`**
```ts
import { defineModule } from '@so/sdk';
import { runMigrations } from './migrate.js';
import { appRoutes } from './routes.js';

export default defineModule({
  id: 'apps',
  dependsOn: ['auth'],
  contributes: { apiRoutes: appRoutes, permissions: ['apps:read', 'apps:write'] },
  async onInstall(ctx) { await runMigrations(ctx.db); },
});

export { validateDefinition, type AppDefinition, type AppWidget } from './definition.js';
export { createAppService, type AppSummary, type AppRecord } from './service.js';
```

- [ ] **Step 10: `packages/apps/test/apps.int.test.ts`**
```ts
import { describe, it, expect, afterAll } from 'vitest';
import { createServer, createConfig, type AppServer } from '@so/server';
import { createLogger } from '@so/observability';
import authModule from '@so/auth';
import appsModule from '../src/index.js';

const config = createConfig({
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so',
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'localhost:9000', S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin', S3_BUCKET: process.env.S3_BUCKET ?? 'so-datasets',
  ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: 'admin',
});
let server: AppServer;
afterAll(async () => { await server?.stop(); });
function cookieFrom(s: string | string[] | undefined): string { const raw = Array.isArray(s) ? s[0]! : s!; return raw.split(';')[0]!; }

describe('apps: app-definition CRUD + validation', () => {
  it('creates, reads, updates, validates, and deletes an app', async () => {
    server = await createServer({ modules: [authModule, appsModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();
    await server.kernel.ctx.db.query(`DELETE FROM apps WHERE name IN ('Ops Console','Ops Console v2')`);

    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const a = { cookie: cookieFrom(login.headers['set-cookie']) };

    const definition = { widgets: [
      { id: 'w1', type: 'object-table', title: 'Flights', config: { objectType: 'Flight' } },
      { id: 'w2', type: 'metric', title: 'Total', config: { objectType: 'Flight' } },
      { id: 'w3', type: 'action-button', title: 'Cancel', config: { action: 'cancelFlight' } },
    ] };
    const create = await server.app.inject({ method: 'POST', url: '/api/apps', headers: a, payload: { name: 'Ops Console', definition } });
    expect(create.statusCode).toBe(201);
    const id = create.json().id;

    const list = await server.app.inject({ method: 'GET', url: '/api/apps', headers: a });
    expect((list.json().apps as Array<{ name: string }>).some((x) => x.name === 'Ops Console')).toBe(true);

    const got = await server.app.inject({ method: 'GET', url: `/api/apps/${id}`, headers: a });
    expect(got.json().definition.widgets).toHaveLength(3);
    expect(got.json().definition.widgets[0].config.objectType).toBe('Flight');

    const upd = await server.app.inject({ method: 'PUT', url: `/api/apps/${id}`, headers: a, payload: { name: 'Ops Console v2' } });
    expect(upd.statusCode).toBe(200);
    const got2 = await server.app.inject({ method: 'GET', url: `/api/apps/${id}`, headers: a });
    expect(got2.json().name).toBe('Ops Console v2');
    expect(got2.json().definition.widgets).toHaveLength(3); // definition preserved on name-only update

    const bad = await server.app.inject({ method: 'POST', url: '/api/apps', headers: a, payload: { name: 'Bad', definition: { widgets: [{ id: 'x', type: 'frobnicate', config: {} }] } } });
    expect(bad.statusCode).toBe(400);

    const del = await server.app.inject({ method: 'DELETE', url: `/api/apps/${id}`, headers: a });
    expect(del.statusCode).toBe(200);
    const gone = await server.app.inject({ method: 'GET', url: `/api/apps/${id}`, headers: a });
    expect(gone.statusCode).toBe(404);
  });
});
```

- [ ] **Step 11: Run → PASS:** `pnpm run infra:up && pnpm --filter @so/apps test` (timeout 180000). typecheck clean; no unused imports.

- [ ] **Step 12: Commit:** `git add -A && git commit -m "feat(apps): app-definition store + validation + CRUD (@so/apps)"`

---

## Task 2: Full verification + merge
- [ ] `pnpm run infra:up && pnpm run infra:seed && pnpm typecheck; pnpm lint; pnpm test` (exit codes) → green; `git checkout main && git merge --ff-only phase27/apps-backend`

---

## Self-review
- **User #4 (app builder), backend** — named apps store a validated widget-graph definition bound to ontology object types/actions; full CRUD. ✓
- **Validation** — known widget types only; required config keys per type enforced; name-only update preserves the definition. ✓
- **Pattern-consistent** — mirrors `@so/pipelines`/`@so/connectors-airflow`; `requirePermission` gating; green-suite integration test. ✓
- **Deferred (→ Plan 28 + backlog):** the builder/runtime UI (Plan 28), more widget types (charts/forms/filters), layout/positioning, per-widget permissions, app versioning/publish. Flagged.
