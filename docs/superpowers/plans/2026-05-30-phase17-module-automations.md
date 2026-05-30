# Phase 17 (4.2) — module-automations Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps `- [ ]`.

**Goal:** Event-driven automations (Foundry Automate equivalent). When an action is executed, a matching automation runs a follow-up action. Built on the kernel **event bus** (`action.executed` events the actions module already emits).

**Architecture:** New `@so/automations` (dependsOn `actions`, `auth`). In `onStart`, subscribes to `action.executed`; on a matching `trigger_action`, executes `then_action` (with fixed `then_edits`) on the same primary key via `@so/actions`'s service. Event delivery is async/fire-and-forget, so the test **polls** for the cascaded effect.

> **Loop safety (noted):** automations only fire on configured `trigger_action`s; the test's `then_action` isn't a trigger, so no loop. General cycle-guarding is deferred.

---

## Pre-flight
- [ ] **Branch:** `git checkout main && git checkout -b phase17/module-automations`

---

## Task 1: `@so/automations`

**Files:** Create `packages/automations/{package.json,tsconfig.json,vitest.config.ts,src/migrate.ts,src/service.ts,src/routes.ts,src/index.ts,test/automations.int.test.ts}`

- [ ] **Step 1: `packages/automations/package.json`**
```json
{
  "name": "@so/automations", "version": "0.0.0", "private": true, "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "dependencies": { "@so/sdk": "workspace:*", "@so/auth": "workspace:*", "@so/actions": "workspace:*", "fastify": "^5.2.0" },
  "devDependencies": { "@so/server": "workspace:*", "@so/observability": "workspace:*", "@so/datasets": "workspace:*", "@so/ontology": "workspace:*", "@types/node": "^22.10.0", "@types/pg": "^8.11.0" }
}
```

- [ ] **Step 2: `pnpm install`**

- [ ] **Step 3: `packages/automations/tsconfig.json`**
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "outDir": "dist", "types": ["node"] }, "include": ["src/**/*", "test/**/*"] }
```

- [ ] **Step 4: `packages/automations/vitest.config.ts`**
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { testTimeout: 60_000, hookTimeout: 60_000 } });
```

- [ ] **Step 5: `packages/automations/src/migrate.ts`**
```ts
import type { Db } from '@so/sdk';

export async function runMigrations(db: Db): Promise<void> {
  await db.query(`CREATE TABLE IF NOT EXISTS automations (
    id text PRIMARY KEY,
    org_id text NOT NULL,
    name text NOT NULL,
    trigger_action text NOT NULL,
    then_action text NOT NULL,
    then_edits jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (org_id, name)
  )`);
}
```

- [ ] **Step 6: `packages/automations/src/service.ts`**
```ts
import { randomUUID } from 'node:crypto';
import type { ModuleContext } from '@so/sdk';

const NAME_RE = /^[A-Za-z0-9_-]+$/;

export interface AutomationInput { name: string; triggerAction: string; thenAction: string; thenEdits: Record<string, unknown>; }

export function createAutomationService(ctx: ModuleContext) {
  async function createAutomation(orgId: string, input: AutomationInput): Promise<string> {
    if (!NAME_RE.test(input.name)) throw new Error('invalid automation name');
    if (!input.triggerAction || !input.thenAction) throw new Error('triggerAction and thenAction required');
    const id = randomUUID();
    await ctx.db.query(
      `INSERT INTO automations(id,org_id,name,trigger_action,then_action,then_edits) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, orgId, input.name, input.triggerAction, input.thenAction, JSON.stringify(input.thenEdits ?? {})],
    );
    return id;
  }

  async function listAutomations(orgId: string): Promise<Array<{ id: string; name: string; triggerAction: string; thenAction: string }>> {
    const rows = await ctx.db.query<{ id: string; name: string; trigger_action: string; then_action: string }>(
      `SELECT id, name, trigger_action, then_action FROM automations WHERE org_id = $1 ORDER BY name`, [orgId],
    );
    return rows.map((r) => ({ id: r.id, name: r.name, triggerAction: r.trigger_action, thenAction: r.then_action }));
  }

  return { createAutomation, listAutomations };
}
```

- [ ] **Step 7: `packages/automations/src/routes.ts`**
```ts
import type { FastifyPluginAsync } from 'fastify';
import { requirePermission } from '@so/auth';
import { createAutomationService, type AutomationInput } from './service.js';

export const automationRoutes: FastifyPluginAsync = async (fastify) => {
  const svc = createAutomationService(fastify.ctx);
  fastify.post('/', { preHandler: requirePermission('automations:write') }, async (req, reply) => {
    const body = req.body as Partial<AutomationInput>;
    if (!body?.name || !body?.triggerAction || !body?.thenAction) return reply.code(400).send({ error: 'name, triggerAction, thenAction required' });
    try { const id = await svc.createAutomation(req.user!.orgId, { name: body.name, triggerAction: body.triggerAction, thenAction: body.thenAction, thenEdits: body.thenEdits ?? {} }); return reply.code(201).send({ id }); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });
  fastify.get('/', { preHandler: requirePermission('automations:read') }, async (req) => ({ automations: await svc.listAutomations(req.user!.orgId) }));
};
```

- [ ] **Step 8: `packages/automations/src/index.ts`**
```ts
import { defineModule } from '@so/sdk';
import { createActionService } from '@so/actions';
import { runMigrations } from './migrate.js';
import { automationRoutes } from './routes.js';

export default defineModule({
  id: 'automations',
  dependsOn: ['actions', 'auth'],
  contributes: { apiRoutes: automationRoutes, permissions: ['automations:read', 'automations:write'] },
  async onInstall(ctx) { await runMigrations(ctx.db); },
  async onStart(ctx) {
    const actions = createActionService(ctx);
    ctx.events.on('action.executed', (payload) => {
      const p = payload as { orgId: string; apiName: string; primaryKey: string };
      void (async () => {
        const autos = await ctx.db.query<{ then_action: string; then_edits: Record<string, unknown> }>(
          `SELECT then_action, then_edits FROM automations WHERE org_id = $1 AND trigger_action = $2`, [p.orgId, p.apiName],
        );
        for (const a of autos) {
          try { await actions.execute(p.orgId, 'automation', a.then_action, { primaryKey: p.primaryKey, edits: a.then_edits }); }
          catch (e) { ctx.log.warn('automation failed', { err: (e as Error).message }); }
        }
      })();
    });
  },
});

export { createAutomationService, type AutomationInput } from './service.js';
```

- [ ] **Step 9: `packages/automations/test/automations.int.test.ts`**
```ts
import { describe, it, expect, afterAll } from 'vitest';
import { createServer, createConfig, type AppServer } from '@so/server';
import { createLogger } from '@so/observability';
import authModule from '@so/auth';
import datasetsModule from '@so/datasets';
import ontologyModule from '@so/ontology';
import actionsModule from '@so/actions';
import automationsModule from '../src/index.js';

const config = createConfig({
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so',
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'localhost:9000', S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin', S3_BUCKET: process.env.S3_BUCKET ?? 'so-datasets',
  ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: 'admin',
});
const OT = 'FlightAuto';
let server: AppServer;
afterAll(async () => { await server?.stop(); });
function cookieFrom(s: string | string[] | undefined): string { const raw = Array.isArray(s) ? s[0]! : s!; return raw.split(';')[0]!; }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('automations: action triggers a follow-up action via the event bus', () => {
  it('cascades setStatus -> setNote', async () => {
    server = await createServer({ modules: [authModule, datasetsModule, ontologyModule, actionsModule, automationsModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();
    const db = server.kernel.ctx.db;
    await db.query(`DELETE FROM automations WHERE name='autonote'`);
    await db.query(`DELETE FROM action_defs WHERE api_name IN ('setStatusAuto','setNoteAuto')`);
    await db.query(`DELETE FROM object_writeback WHERE object_type=$1`, [OT]);
    await db.query(`DELETE FROM object_properties WHERE object_type_id IN (SELECT id FROM object_types WHERE org_id='org_default' AND api_name=$1)`, [OT]);
    await db.query(`DELETE FROM object_types WHERE org_id='org_default' AND api_name=$1`, [OT]);

    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const auth = { cookie: cookieFrom(login.headers['set-cookie']) };
    const up = await server.app.inject({ method: 'POST', url: '/api/datasets?name=autods&format=csv', headers: { ...auth, 'content-type': 'text/csv' }, payload: 'flight_no,status,note\nFL-1,Boarding,plain\n' });
    const datasetId = up.json().dataset.id as string;
    await server.app.inject({ method: 'POST', url: '/api/ontology/object-types', headers: auth, payload: { apiName: OT, datasetId, primaryKey: 'flightNumber', properties: [ { apiName: 'flightNumber', column: 'flight_no', type: 'string' }, { apiName: 'status', column: 'status', type: 'string' }, { apiName: 'note', column: 'note', type: 'string' } ] } });
    await server.app.inject({ method: 'POST', url: '/api/actions/definitions', headers: auth, payload: { apiName: 'setStatusAuto', objectType: OT, kind: 'modify' } });
    await server.app.inject({ method: 'POST', url: '/api/actions/definitions', headers: auth, payload: { apiName: 'setNoteAuto', objectType: OT, kind: 'modify' } });

    const auto = await server.app.inject({ method: 'POST', url: '/api/automations', headers: auth, payload: { name: 'autonote', triggerAction: 'setStatusAuto', thenAction: 'setNoteAuto', thenEdits: { note: 'auto' } } });
    expect(auto.statusCode).toBe(201);

    // execute the trigger action
    await server.app.inject({ method: 'POST', url: '/api/actions/setStatusAuto/execute', headers: auth, payload: { primaryKey: 'FL-1', edits: { status: 'Departed' } } });

    // poll for the cascaded effect (event delivery is async)
    let note: string | undefined;
    for (let i = 0; i < 40; i++) {
      const objs = await server.app.inject({ method: 'GET', url: `/api/ontology/object-types/${OT}/objects`, headers: auth });
      const fl1 = (objs.json().objects as Array<{ flightNumber: string; status: string; note: string }>).find((o) => o.flightNumber === 'FL-1');
      if (fl1?.note === 'auto') { note = fl1.note; expect(fl1.status).toBe('Departed'); break; }
      await sleep(100);
    }
    expect(note).toBe('auto');
  });
});
```

- [ ] **Step 10: Run with infra up → PASS:** `pnpm run infra:up && pnpm --filter @so/automations test` (timeout 180000). Then `pnpm --filter @so/automations run typecheck` clean. No unused imports.

- [ ] **Step 11: Commit:** `git add -A && git commit -m "feat(automations): event-driven follow-up actions (action.executed)"`

---

## Task 2: Full verification + merge
- [ ] `pnpm run infra:up && pnpm run infra:seed && pnpm typecheck && pnpm lint && pnpm test` → green; `git checkout main && git merge --ff-only phase17/module-automations`

---

## Self-review
- **Spec §13 Phase 4 (automations)** — event-driven rules firing follow-up actions; uses the kernel event bus end-to-end. ✓
- **Additive** — new package; relies on the `action.executed` event the actions module already emits; no merged changes. ✓
- **Async correctness** — handler is fire-and-forget; the test polls for the cascade rather than assuming synchronous delivery. ✓
- **Deferred:** cycle/loop guarding, conditional triggers, derived (not fixed) edits, retries/dead-letter, automation run history. Flagged.
