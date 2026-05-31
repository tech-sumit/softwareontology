# Phase 37 — `@so/projects` Module Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps `- [ ]`.

**Goal:** The Projects foundation — an account (org) holds many **Projects**. New `@so/projects` module: a `projects` table, a bootstrapped **"Default"** project, and CRUD API. Pure addition (no other module changes yet), so zero blast radius.

**Architecture:** Mirrors existing leaf modules (e.g. `@so/apps`). `dependsOn: ['auth']`. Migrations via the shared `applyMigrations` helper, which also bootstraps `project_default`. Scoped resources will adopt `project_id` in later plans; they will NOT depend on this module (they read an `X-Project` header + filter by a string), so there's no dependency inversion.

---

## Pre-flight
- [ ] **Branch:** `git checkout main && git checkout -b phase37/projects-module`

---

## Task 1: `@so/projects`

**Files:** Create `packages/projects/{package.json,tsconfig.json,vitest.config.ts,src/migrate.ts,src/service.ts,src/routes.ts,src/index.ts,test/projects.int.test.ts}`

- [ ] **Step 1: `packages/projects/package.json`**
```json
{
  "name": "@so/projects", "version": "0.0.0", "private": true, "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "dependencies": { "@so/sdk": "workspace:*", "@so/auth": "workspace:*", "fastify": "^5.2.0" },
  "devDependencies": { "@so/server": "workspace:*", "@so/observability": "workspace:*", "@types/node": "^22.10.0" }
}
```

- [ ] **Step 2: `pnpm install`**

- [ ] **Step 3: `packages/projects/tsconfig.json`**
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "outDir": "dist", "types": ["node"] }, "include": ["src/**/*", "test/**/*"] }
```

- [ ] **Step 4: `packages/projects/vitest.config.ts`**
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { testTimeout: 60_000, hookTimeout: 60_000 } });
```

- [ ] **Step 5: `packages/projects/src/migrate.ts`**
```ts
import { applyMigrations, type Db } from '@so/sdk';

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS projects (
    id text PRIMARY KEY,
    org_id text NOT NULL,
    name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (org_id, name)
  )`,
  `INSERT INTO projects(id, org_id, name) VALUES ('project_default', 'org_default', 'Default') ON CONFLICT DO NOTHING`,
];

export async function runMigrations(db: Db): Promise<void> {
  await applyMigrations(db, 'projects', MIGRATIONS);
}
```

- [ ] **Step 6: `packages/projects/src/service.ts`**
```ts
import { randomUUID } from 'node:crypto';
import type { ModuleContext } from '@so/sdk';

const NAME_RE = /^[A-Za-z0-9 _-]+$/;

export interface Project { id: string; name: string; }

export function createProjectService(ctx: ModuleContext) {
  async function createProject(orgId: string, name: string): Promise<string> {
    if (!name || !NAME_RE.test(name)) throw new Error('invalid project name');
    const existing = await ctx.db.query<{ id: string }>(`SELECT id FROM projects WHERE org_id = $1 AND name = $2`, [orgId, name]);
    if (existing[0]) return existing[0].id;
    const id = randomUUID();
    await ctx.db.query(`INSERT INTO projects(id,org_id,name) VALUES ($1,$2,$3)`, [id, orgId, name]);
    return id;
  }

  async function listProjects(orgId: string): Promise<Project[]> {
    return ctx.db.query<Project>(`SELECT id, name FROM projects WHERE org_id = $1 ORDER BY (id = 'project_default') DESC, name`, [orgId]);
  }

  async function getProject(orgId: string, id: string): Promise<Project | null> {
    const rows = await ctx.db.query<Project>(`SELECT id, name FROM projects WHERE org_id = $1 AND id = $2`, [orgId, id]);
    return rows[0] ?? null;
  }

  return { createProject, listProjects, getProject };
}
```

- [ ] **Step 7: `packages/projects/src/routes.ts`**
```ts
import type { FastifyPluginAsync } from 'fastify';
import { requirePermission } from '@so/auth';
import { createProjectService } from './service.js';

export const projectRoutes: FastifyPluginAsync = async (fastify) => {
  const svc = createProjectService(fastify.ctx);

  fastify.post('/', { preHandler: requirePermission('projects:write') }, async (req, reply) => {
    const b = req.body as { name?: string };
    if (!b?.name) return reply.code(400).send({ error: 'name required' });
    try { return reply.code(201).send({ id: await svc.createProject(req.user!.orgId, b.name) }); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  fastify.get('/', { preHandler: requirePermission('projects:read') }, async (req) => ({ projects: await svc.listProjects(req.user!.orgId) }));

  fastify.get('/:id', { preHandler: requirePermission('projects:read') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = await svc.getProject(req.user!.orgId, id);
    return p ? reply.send(p) : reply.code(404).send({ error: 'project not found' });
  });
};
```

- [ ] **Step 8: `packages/projects/src/index.ts`**
```ts
import { defineModule } from '@so/sdk';
import { runMigrations } from './migrate.js';
import { projectRoutes } from './routes.js';

export default defineModule({
  id: 'projects',
  dependsOn: ['auth'],
  contributes: { apiRoutes: projectRoutes, permissions: ['projects:read', 'projects:write'] },
  async onInstall(ctx) { await runMigrations(ctx.db); },
});

export { createProjectService, type Project } from './service.js';
```

- [ ] **Step 9: `packages/projects/test/projects.int.test.ts`**
```ts
import { describe, it, expect, afterAll } from 'vitest';
import { createServer, createConfig, type AppServer } from '@so/server';
import { createLogger } from '@so/observability';
import authModule from '@so/auth';
import projectsModule from '../src/index.js';

const config = createConfig({
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so',
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'localhost:9000', S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin', S3_BUCKET: process.env.S3_BUCKET ?? 'so-datasets',
  ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: 'admin',
});
let server: AppServer;
afterAll(async () => { await server?.stop(); });
function cookieFrom(s: string | string[] | undefined): string { const raw = Array.isArray(s) ? s[0]! : s!; return raw.split(';')[0]!; }

describe('projects: CRUD + Default bootstrap', () => {
  it('bootstraps Default and creates/lists/gets projects', async () => {
    server = await createServer({ modules: [authModule, projectsModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();
    await server.kernel.ctx.db.query(`DELETE FROM projects WHERE name='Marketing'`);

    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const a = { cookie: cookieFrom(login.headers['set-cookie']) };

    // Default exists from bootstrap, listed first
    const list0 = await server.app.inject({ method: 'GET', url: '/api/projects', headers: a });
    const names0 = (list0.json().projects as Array<{ id: string; name: string }>);
    expect(names0.some((p) => p.id === 'project_default' && p.name === 'Default')).toBe(true);
    expect(names0[0]!.id).toBe('project_default'); // Default sorted first

    const create = await server.app.inject({ method: 'POST', url: '/api/projects', headers: a, payload: { name: 'Marketing' } });
    expect(create.statusCode).toBe(201);
    const id = create.json().id;

    const got = await server.app.inject({ method: 'GET', url: `/api/projects/${id}`, headers: a });
    expect(got.json().name).toBe('Marketing');

    const list = await server.app.inject({ method: 'GET', url: '/api/projects', headers: a });
    expect((list.json().projects as Array<{ name: string }>).some((p) => p.name === 'Marketing')).toBe(true);

    // idempotent create returns the same id
    const again = await server.app.inject({ method: 'POST', url: '/api/projects', headers: a, payload: { name: 'Marketing' } });
    expect(again.json().id).toBe(id);
  });
});
```

- [ ] **Step 10: Run → PASS:** `pnpm run infra:up && pnpm --filter @so/projects test` (timeout 180000). typecheck clean; no unused imports.

- [ ] **Step 11: Commit:** `git add -A && git commit -m "feat(projects): @so/projects module — projects table + Default + CRUD"`

---

## Task 2: Full verification + merge (GATED)
- [ ] `pnpm run infra:up && pnpm run infra:seed && pnpm typecheck; pnpm lint`; then `pnpm test >/tmp/v.log 2>&1; t=$?; grep -E "Tests +[0-9]+ (passed|failed)" /tmp/v.log | tail -1`. **Only if typecheck, lint, and `t` are all 0**: `git checkout main && git merge --ff-only phase37/projects-module`. (Do NOT merge red.)

---

## Self-review
- **Projects foundation** — org holds many projects; Default bootstrapped; CRUD. ✓
- **Zero blast radius** — pure new module; scoped modules will read an `X-Project` header (Plan 38+) and won't depend on this module. ✓
- **Idempotent** — Default bootstrap + create are `ON CONFLICT DO NOTHING` / return-existing; test cleans `Marketing`. ✓
- **Deferred:** per-project ACLs, rename/delete/archive, project description/metadata. Flagged.
