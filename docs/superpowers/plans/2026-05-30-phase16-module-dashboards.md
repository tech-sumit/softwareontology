# Phase 16 (3.1) — module-dashboards Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps `- [ ]`.

**Goal:** Aggregation over an object set — group-by + count — the data layer for charts/dashboards. Computed over the *resolved* object set (so it reflects write-back edits, not just base data).

**Architecture:** New `@so/dashboards` (dependsOn `ontology`, `auth`). `aggregate(objectType, groupBy)` resolves the object set via `@so/ontology` and groups in JS. Route auth-gated.

> **Scale note:** JS-side aggregation over resolved rows is correct (includes overlay) and fine for now; push-down GROUP BY into DuckDB is deferred for large sets.

---

## Pre-flight
- [ ] **Branch:** `git checkout main && git checkout -b phase16/module-dashboards`

---

## Task 1: `@so/dashboards`

**Files:** Create `packages/dashboards/{package.json,tsconfig.json,vitest.config.ts,src/service.ts,src/routes.ts,src/index.ts,test/dashboards.int.test.ts}`

- [ ] **Step 1: `packages/dashboards/package.json`**
```json
{
  "name": "@so/dashboards", "version": "0.0.0", "private": true, "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "dependencies": { "@so/sdk": "workspace:*", "@so/auth": "workspace:*", "@so/ontology": "workspace:*", "fastify": "^5.2.0" },
  "devDependencies": { "@so/server": "workspace:*", "@so/observability": "workspace:*", "@so/datasets": "workspace:*", "@types/node": "^22.10.0", "@types/pg": "^8.11.0" }
}
```

- [ ] **Step 2: `pnpm install`**

- [ ] **Step 3: `packages/dashboards/tsconfig.json`**
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "outDir": "dist", "types": ["node"] }, "include": ["src/**/*", "test/**/*"] }
```

- [ ] **Step 4: `packages/dashboards/vitest.config.ts`**
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { testTimeout: 60_000, hookTimeout: 60_000 } });
```

- [ ] **Step 5: `packages/dashboards/src/service.ts`**
```ts
import type { ModuleContext } from '@so/sdk';
import { createOntologyService } from '@so/ontology';

export interface Bucket { group: string; count: number; }

export function createDashboardService(ctx: ModuleContext) {
  const ontology = createOntologyService(ctx);
  async function aggregate(orgId: string, objectType: string, groupBy: string): Promise<Bucket[]> {
    const objects = await ontology.resolveObjects(orgId, objectType, { limit: 10000 });
    const counts = new Map<string, number>();
    for (const o of objects) {
      const key = o[groupBy] === null || o[groupBy] === undefined ? '∅' : String(o[groupBy]);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts, ([group, count]) => ({ group, count })).sort((a, b) => a.group.localeCompare(b.group));
  }
  return { aggregate };
}
```

- [ ] **Step 6: `packages/dashboards/src/routes.ts`**
```ts
import type { FastifyPluginAsync } from 'fastify';
import { requirePermission } from '@so/auth';
import { createDashboardService } from './service.js';

export const dashboardRoutes: FastifyPluginAsync = async (fastify) => {
  const svc = createDashboardService(fastify.ctx);
  fastify.post('/aggregate', { preHandler: requirePermission('ontology:read') }, async (req, reply) => {
    const body = req.body as { objectType?: string; groupBy?: string };
    if (!body?.objectType || !body?.groupBy) return reply.code(400).send({ error: 'objectType and groupBy required' });
    try { return { buckets: await svc.aggregate(req.user!.orgId, body.objectType, body.groupBy) }; }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });
};
```

- [ ] **Step 7: `packages/dashboards/src/index.ts`**
```ts
import { defineModule } from '@so/sdk';
import { dashboardRoutes } from './routes.js';

export default defineModule({
  id: 'dashboards',
  dependsOn: ['ontology', 'auth'],
  contributes: { apiRoutes: dashboardRoutes, permissions: ['dashboards:read'] },
});

export { createDashboardService, type Bucket } from './service.js';
```

- [ ] **Step 8: `packages/dashboards/test/dashboards.int.test.ts`**
```ts
import { describe, it, expect, afterAll } from 'vitest';
import { createServer, createConfig, type AppServer } from '@so/server';
import { createLogger } from '@so/observability';
import authModule from '@so/auth';
import datasetsModule from '@so/datasets';
import ontologyModule from '@so/ontology';
import dashboardsModule from '../src/index.js';

const config = createConfig({
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so',
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'localhost:9000', S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin', S3_BUCKET: process.env.S3_BUCKET ?? 'so-datasets',
  ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: 'admin',
});
const OT = 'FlightDash';
let server: AppServer;
afterAll(async () => { await server?.stop(); });
function cookieFrom(s: string | string[] | undefined): string { const raw = Array.isArray(s) ? s[0]! : s!; return raw.split(';')[0]!; }

describe('dashboards: group-by aggregation over an object set', () => {
  it('counts flights by status', async () => {
    server = await createServer({ modules: [authModule, datasetsModule, ontologyModule, dashboardsModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();
    const db = server.kernel.ctx.db;
    await db.query(`DELETE FROM object_properties WHERE object_type_id IN (SELECT id FROM object_types WHERE org_id='org_default' AND api_name=$1)`, [OT]);
    await db.query(`DELETE FROM object_types WHERE org_id='org_default' AND api_name=$1`, [OT]);

    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const auth = { cookie: cookieFrom(login.headers['set-cookie']) };
    const up = await server.app.inject({ method: 'POST', url: '/api/datasets?name=dashds&format=csv', headers: { ...auth, 'content-type': 'text/csv' }, payload: 'flight_no,status\nFL-1,Delayed\nFL-2,Delayed\nFL-3,Boarding\n' });
    const datasetId = up.json().dataset.id as string;
    await server.app.inject({ method: 'POST', url: '/api/ontology/object-types', headers: auth, payload: { apiName: OT, datasetId, primaryKey: 'flightNumber', properties: [ { apiName: 'flightNumber', column: 'flight_no', type: 'string' }, { apiName: 'status', column: 'status', type: 'string' } ] } });

    const agg = await server.app.inject({ method: 'POST', url: '/api/dashboards/aggregate', headers: auth, payload: { objectType: OT, groupBy: 'status' } });
    expect(agg.statusCode).toBe(200);
    expect(agg.json().buckets).toEqual([{ group: 'Boarding', count: 1 }, { group: 'Delayed', count: 2 }]);

    const noauth = await server.app.inject({ method: 'POST', url: '/api/dashboards/aggregate', payload: { objectType: OT, groupBy: 'status' } });
    expect(noauth.statusCode).toBe(401);
  });
});
```

- [ ] **Step 9: Run with infra up → PASS:** `pnpm run infra:up && pnpm --filter @so/dashboards test` (timeout 180000). Then `pnpm --filter @so/dashboards run typecheck` clean. No unused imports.

- [ ] **Step 10: Commit:** `git add -A && git commit -m "feat(dashboards): group-by aggregation over object sets"`

---

## Task 2: Full verification + merge
- [ ] `pnpm run infra:up && pnpm run infra:seed && pnpm typecheck && pnpm lint && pnpm test` → green; `git checkout main && git merge --ff-only phase16/module-dashboards`

---

## Self-review
- **Spec §6 Phase 3 (dashboards)** — aggregation data over object sets for charting. ✓
- **Overlay-correct** — aggregates the resolved set (reflects write-back edits). ✓
- **Additive** — new package; no merged changes. ✓
- **Deferred:** sum/avg/min/max metrics, multi-dimension group-by, DuckDB push-down for large sets, saved dashboards + chart UI. Flagged.
