# Phase 14 (2.5) — module-lineage Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps `- [ ]`.

**Goal:** Lineage for an object type — its backing dataset, the actions targeting it, and its link types — derived read-only from existing metadata.

**Architecture:** New `@so/lineage` (dependsOn `ontology`, `datasets`, `actions`, `auth`), read-only over `object_types`/`datasets`/`action_defs`/`link_types`. (Pipeline→dataset provenance edges are deferred — they need producers to record provenance.)

---

## Pre-flight
- [ ] **Branch:** `git checkout main && git checkout -b phase14/module-lineage`

---

## Task 1: `@so/lineage`

**Files:** Create `packages/lineage/{package.json,tsconfig.json,vitest.config.ts,src/service.ts,src/routes.ts,src/index.ts,test/lineage.int.test.ts}`

- [ ] **Step 1: `packages/lineage/package.json`**
```json
{
  "name": "@so/lineage", "version": "0.0.0", "private": true, "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "dependencies": { "@so/sdk": "workspace:*", "@so/auth": "workspace:*", "fastify": "^5.2.0" },
  "devDependencies": { "@so/server": "workspace:*", "@so/observability": "workspace:*", "@so/datasets": "workspace:*", "@so/ontology": "workspace:*", "@so/actions": "workspace:*", "@types/node": "^22.10.0", "@types/pg": "^8.11.0" }
}
```

- [ ] **Step 2: `pnpm install`**

- [ ] **Step 3: `packages/lineage/tsconfig.json`**
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "outDir": "dist", "types": ["node"] }, "include": ["src/**/*", "test/**/*"] }
```

- [ ] **Step 4: `packages/lineage/vitest.config.ts`**
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { testTimeout: 60_000, hookTimeout: 60_000 } });
```

- [ ] **Step 5: `packages/lineage/src/service.ts`**
```ts
import type { ModuleContext } from '@so/sdk';

export interface ObjectTypeLineage {
  objectType: string;
  backingDataset: string | null;
  actions: string[];
  links: string[];
}

export function createLineageService(ctx: ModuleContext) {
  async function forObjectType(orgId: string, apiName: string): Promise<ObjectTypeLineage | null> {
    const ot = await ctx.db.query<{ id: string; dataset_id: string }>(
      `SELECT id, dataset_id FROM object_types WHERE org_id = $1 AND api_name = $2`, [orgId, apiName],
    );
    if (!ot[0]) return null;
    const ds = await ctx.db.query<{ name: string }>(`SELECT name FROM datasets WHERE id = $1`, [ot[0].dataset_id]);
    const actions = await ctx.db.query<{ api_name: string }>(`SELECT api_name FROM action_defs WHERE org_id = $1 AND object_type = $2 ORDER BY api_name`, [orgId, apiName]);
    const links = await ctx.db.query<{ api_name: string }>(`SELECT api_name FROM link_types WHERE org_id = $1 AND (from_object_type_id = $2 OR to_object_type_id = $2) ORDER BY api_name`, [orgId, ot[0].id]);
    return { objectType: apiName, backingDataset: ds[0]?.name ?? null, actions: actions.map((a) => a.api_name), links: links.map((l) => l.api_name) };
  }
  return { forObjectType };
}
```

- [ ] **Step 6: `packages/lineage/src/routes.ts`**
```ts
import type { FastifyPluginAsync } from 'fastify';
import { requirePermission } from '@so/auth';
import { createLineageService } from './service.js';

export const lineageRoutes: FastifyPluginAsync = async (fastify) => {
  const svc = createLineageService(fastify.ctx);
  fastify.get('/object-types/:apiName', { preHandler: requirePermission('ontology:read') }, async (req, reply) => {
    const { apiName } = req.params as { apiName: string };
    const lin = await svc.forObjectType(req.user!.orgId, apiName);
    if (!lin) return reply.code(404).send({ error: 'not found' });
    return { lineage: lin };
  });
};
```

- [ ] **Step 7: `packages/lineage/src/index.ts`**
```ts
import { defineModule } from '@so/sdk';
import { lineageRoutes } from './routes.js';

export default defineModule({
  id: 'lineage',
  dependsOn: ['ontology', 'datasets', 'actions', 'auth'],
  contributes: { apiRoutes: lineageRoutes },
});

export { createLineageService, type ObjectTypeLineage } from './service.js';
```

- [ ] **Step 8: `packages/lineage/test/lineage.int.test.ts`**
```ts
import { describe, it, expect, afterAll } from 'vitest';
import { createServer, createConfig, type AppServer } from '@so/server';
import { createLogger } from '@so/observability';
import authModule from '@so/auth';
import datasetsModule from '@so/datasets';
import ontologyModule from '@so/ontology';
import actionsModule from '@so/actions';
import lineageModule from '../src/index.js';

const config = createConfig({
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so',
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'localhost:9000', S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin', S3_BUCKET: process.env.S3_BUCKET ?? 'so-datasets',
  ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: 'admin',
});
const OT = 'FlightLin';
let server: AppServer;
afterAll(async () => { await server?.stop(); });
function cookieFrom(s: string | string[] | undefined): string { const raw = Array.isArray(s) ? s[0]! : s!; return raw.split(';')[0]!; }

describe('lineage: object type → dataset + actions', () => {
  it('reports the backing dataset and actions', async () => {
    server = await createServer({ modules: [authModule, datasetsModule, ontologyModule, actionsModule, lineageModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();
    const db = server.kernel.ctx.db;
    await db.query(`DELETE FROM action_defs WHERE api_name='setLinStatus'`);
    await db.query(`DELETE FROM object_properties WHERE object_type_id IN (SELECT id FROM object_types WHERE org_id='org_default' AND api_name=$1)`, [OT]);
    await db.query(`DELETE FROM object_types WHERE org_id='org_default' AND api_name=$1`, [OT]);

    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const auth = { cookie: cookieFrom(login.headers['set-cookie']) };
    const up = await server.app.inject({ method: 'POST', url: '/api/datasets?name=linds&format=csv', headers: { ...auth, 'content-type': 'text/csv' }, payload: 'flight_no,status\nFL-1,Delayed\n' });
    const datasetId = up.json().dataset.id as string;
    await server.app.inject({ method: 'POST', url: '/api/ontology/object-types', headers: auth, payload: { apiName: OT, datasetId, primaryKey: 'flightNumber', properties: [ { apiName: 'flightNumber', column: 'flight_no', type: 'string' }, { apiName: 'status', column: 'status', type: 'string' } ] } });
    await server.app.inject({ method: 'POST', url: '/api/actions/definitions', headers: auth, payload: { apiName: 'setLinStatus', objectType: OT, kind: 'modify' } });

    const lin = await server.app.inject({ method: 'GET', url: `/api/lineage/object-types/${OT}`, headers: auth });
    expect(lin.statusCode).toBe(200);
    const l = lin.json().lineage as { backingDataset: string; actions: string[] };
    expect(l.backingDataset).toBe('linds');
    expect(l.actions).toContain('setLinStatus');

    const noauth = await server.app.inject({ method: 'GET', url: `/api/lineage/object-types/${OT}` });
    expect(noauth.statusCode).toBe(401);
  });
});
```

- [ ] **Step 9: Run with infra up → PASS:** `pnpm run infra:up && pnpm --filter @so/lineage test` (timeout 180000). Then `pnpm --filter @so/lineage run typecheck` clean. No unused imports.

- [ ] **Step 10: Commit:** `git add -A && git commit -m "feat(lineage): object-type lineage (backing dataset + actions + links)"`

---

## Task 2: Full verification + merge
- [ ] `pnpm run infra:up && pnpm run infra:seed && pnpm typecheck && pnpm lint && pnpm test` → green; `git checkout main && git merge --ff-only phase14/module-lineage`

---

## Self-review
- **Spec §6 (lineage)** — object-type → backing dataset, actions, links; derived read-only. ✓
- **Additive** — new package; no merged changes. ✓
- **Deferred:** pipeline/connector → output-dataset provenance (needs producers to record edges), full graph traversal/visualization, dataset-direction lineage. Flagged.
