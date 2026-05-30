# Phase 13 (2.4) — module-catalog (audit + search) Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** Governance/discovery: an **audit-log viewer** (over the `audit_log` actions already write) and a **global search** across object types, datasets, and actions by name.

**Architecture:** New `@so/catalog` (dependsOn `actions`, `ontology`, `datasets`, `auth`) — read-only over existing tables (`audit_log`, `object_types`, `datasets`, `action_defs`). Routes auth-gated.

---

## Pre-flight
- [ ] **Branch:** `git checkout main && git checkout -b phase13/module-catalog`

---

## Task 1: `@so/catalog`

**Files:** Create `packages/catalog/{package.json,tsconfig.json,vitest.config.ts,src/service.ts,src/routes.ts,src/index.ts,test/catalog.int.test.ts}`

- [ ] **Step 1: `packages/catalog/package.json`**

```json
{
  "name": "@so/catalog",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "dependencies": { "@so/sdk": "workspace:*", "@so/auth": "workspace:*", "fastify": "^5.2.0" },
  "devDependencies": { "@so/server": "workspace:*", "@so/observability": "workspace:*", "@so/datasets": "workspace:*", "@so/ontology": "workspace:*", "@so/actions": "workspace:*", "@types/node": "^22.10.0", "@types/pg": "^8.11.0" }
}
```

- [ ] **Step 2: `pnpm install`**

- [ ] **Step 3: `packages/catalog/tsconfig.json`**

```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "outDir": "dist", "types": ["node"] }, "include": ["src/**/*", "test/**/*"] }
```

- [ ] **Step 4: `packages/catalog/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { testTimeout: 60_000, hookTimeout: 60_000 } });
```

- [ ] **Step 5: `packages/catalog/src/service.ts`**

```ts
import type { ModuleContext } from '@so/sdk';

export interface AuditEntry { actor: string | null; action: string; objectType: string; primaryKey: string | null; createdAt: string; }
export interface SearchHit { kind: string; name: string; }

export function createCatalogService(ctx: ModuleContext) {
  async function audit(orgId: string, filters: { action?: string; objectType?: string }): Promise<AuditEntry[]> {
    const where: string[] = ['org_id = $1'];
    const params: unknown[] = [orgId];
    if (filters.action) { params.push(filters.action); where.push(`action = $${params.length}`); }
    if (filters.objectType) { params.push(filters.objectType); where.push(`object_type = $${params.length}`); }
    const rows = await ctx.db.query<{ actor: string | null; action: string; object_type: string; primary_key: string | null; created_at: string }>(
      `SELECT actor, action, object_type, primary_key, created_at FROM audit_log WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 100`,
      params,
    );
    return rows.map((r) => ({ actor: r.actor, action: r.action, objectType: r.object_type, primaryKey: r.primary_key, createdAt: r.created_at }));
  }

  async function search(orgId: string, q: string): Promise<SearchHit[]> {
    const like = `%${q}%`;
    const rows = await ctx.db.query<{ kind: string; name: string }>(
      `SELECT 'objectType' AS kind, api_name AS name FROM object_types WHERE org_id = $1 AND api_name ILIKE $2
       UNION ALL SELECT 'dataset' AS kind, name FROM datasets WHERE org_id = $1 AND name ILIKE $2
       UNION ALL SELECT 'action' AS kind, api_name AS name FROM action_defs WHERE org_id = $1 AND api_name ILIKE $2
       ORDER BY kind, name LIMIT 50`,
      [orgId, like],
    );
    return rows.map((r) => ({ kind: r.kind, name: r.name }));
  }

  return { audit, search };
}
```

- [ ] **Step 6: `packages/catalog/src/routes.ts`**

```ts
import type { FastifyPluginAsync } from 'fastify';
import { requirePermission } from '@so/auth';
import { createCatalogService } from './service.js';

export const catalogRoutes: FastifyPluginAsync = async (fastify) => {
  const svc = createCatalogService(fastify.ctx);

  fastify.get('/audit', { preHandler: requirePermission('catalog:read') }, async (req) => {
    const q = req.query as { action?: string; objectType?: string };
    return { entries: await svc.audit(req.user!.orgId, { action: q.action, objectType: q.objectType }) };
  });

  fastify.get('/search', { preHandler: requirePermission('catalog:read') }, async (req, reply) => {
    const q = req.query as { q?: string };
    if (!q.q) return reply.code(400).send({ error: 'q required' });
    return { hits: await svc.search(req.user!.orgId, q.q) };
  });
};
```

- [ ] **Step 7: `packages/catalog/src/index.ts`**

```ts
import { defineModule } from '@so/sdk';
import { catalogRoutes } from './routes.js';

export default defineModule({
  id: 'catalog',
  dependsOn: ['actions', 'ontology', 'datasets', 'auth'],
  contributes: { apiRoutes: catalogRoutes, permissions: ['catalog:read'] },
});

export { createCatalogService, type AuditEntry, type SearchHit } from './service.js';
```

- [ ] **Step 8: `packages/catalog/test/catalog.int.test.ts`**

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { createServer, createConfig, type AppServer } from '@so/server';
import { createLogger } from '@so/observability';
import authModule from '@so/auth';
import datasetsModule from '@so/datasets';
import ontologyModule from '@so/ontology';
import actionsModule from '@so/actions';
import catalogModule from '../src/index.js';

const config = createConfig({
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so',
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'localhost:9000', S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin', S3_BUCKET: process.env.S3_BUCKET ?? 'so-datasets',
  ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: 'admin',
});

let server: AppServer;
afterAll(async () => { await server?.stop(); });
function cookieFrom(s: string | string[] | undefined): string { const raw = Array.isArray(s) ? s[0]! : s!; return raw.split(';')[0]!; }

describe('catalog: audit + search', () => {
  it('searches names and lists audit entries', async () => {
    server = await createServer({ modules: [authModule, datasetsModule, ontologyModule, actionsModule, catalogModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();
    const db = server.kernel.ctx.db;
    // seed one audit row + a searchable dataset
    await db.query(`DELETE FROM datasets WHERE name='catalogds'`);
    await db.query(`INSERT INTO datasets(id,org_id,name,object_key,row_count) VALUES ('catds','org_default','catalogds','k',0) ON CONFLICT (id) DO NOTHING`);
    await db.query(`INSERT INTO audit_log(id,org_id,actor,action,object_type,primary_key,params) VALUES ('cataudit','org_default','admin','testAction','Widget','W1','{}') ON CONFLICT (id) DO NOTHING`);

    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const auth = { cookie: cookieFrom(login.headers['set-cookie']) };

    const search = await server.app.inject({ method: 'GET', url: '/api/catalog/search?q=catalogds', headers: auth });
    expect(search.statusCode).toBe(200);
    expect((search.json().hits as Array<{ kind: string; name: string }>)).toEqual([{ kind: 'dataset', name: 'catalogds' }]);

    const audit = await server.app.inject({ method: 'GET', url: '/api/catalog/audit?action=testAction', headers: auth });
    expect(audit.statusCode).toBe(200);
    const entries = audit.json().entries as Array<{ action: string; objectType: string }>;
    expect(entries.some((e) => e.action === 'testAction' && e.objectType === 'Widget')).toBe(true);

    const noauth = await server.app.inject({ method: 'GET', url: '/api/catalog/search?q=x' });
    expect(noauth.statusCode).toBe(401);
  });
});
```

- [ ] **Step 9: Run with infra up → PASS:** `pnpm run infra:up && pnpm --filter @so/catalog test` (timeout 180000). Then `pnpm --filter @so/catalog run typecheck` clean. No unused imports.

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "feat(catalog): audit-log viewer + global search"
```

---

## Task 2: Full verification + merge
- [ ] `pnpm run infra:up && pnpm run infra:seed && pnpm typecheck && pnpm lint && pnpm test` → green; then `git checkout main && git merge --ff-only phase13/module-catalog`

---

## Self-review
- **Spec §6 (audit + search)** — audit viewer over `audit_log`; global catalog search across object types/datasets/actions. ✓
- **Additive / read-only** — new package; no merged code modified; uses existing tables. ✓
- **Security** — `catalog:read`-gated; parameterized ILIKE. ✓
- **Deferred:** full-text/ranked search, lineage edges (next), pagination, per-resource ACL filtering of results. Flagged.
