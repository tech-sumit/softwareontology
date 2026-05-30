# Phase 15 (4.1) — module-aip Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps `- [ ]`.

**Goal:** The AIP layer — an LLM gateway over the ontology. `complete(prompt)` and `ask(objectType, question)` (resolves the object set, builds a context prompt, calls the provider). **Air-gap-respecting:** default `echo` provider makes no external calls (deterministic, testable); an optional config-gated `http` provider targets a local/cloud OpenAI-compatible endpoint.

**Architecture:** New `@so/aip` (dependsOn `ontology`, `auth`). Provider selected by `AIP_PROVIDER` (default `echo`). `ask` uses `@so/ontology`'s `resolveObjects`. Routes auth-gated.

> **No phone-home:** nothing calls an external service unless the deployment sets `AIP_PROVIDER=http` + `AIP_ENDPOINT` — honoring the air-gap rule.

---

## Pre-flight
- [ ] **Branch:** `git checkout main && git checkout -b phase15/module-aip`

---

## Task 1: `@so/aip`

**Files:** Create `packages/aip/{package.json,tsconfig.json,vitest.config.ts,src/service.ts,src/routes.ts,src/index.ts,test/aip.int.test.ts}`

- [ ] **Step 1: `packages/aip/package.json`**
```json
{
  "name": "@so/aip", "version": "0.0.0", "private": true, "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "dependencies": { "@so/sdk": "workspace:*", "@so/auth": "workspace:*", "@so/ontology": "workspace:*", "fastify": "^5.2.0" },
  "devDependencies": { "@so/server": "workspace:*", "@so/observability": "workspace:*", "@so/datasets": "workspace:*", "@types/node": "^22.10.0", "@types/pg": "^8.11.0" }
}
```

- [ ] **Step 2: `pnpm install`**

- [ ] **Step 3: `packages/aip/tsconfig.json`**
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "outDir": "dist", "types": ["node"] }, "include": ["src/**/*", "test/**/*"] }
```

- [ ] **Step 4: `packages/aip/vitest.config.ts`**
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { testTimeout: 60_000, hookTimeout: 60_000 } });
```

- [ ] **Step 5: `packages/aip/src/service.ts`**
```ts
import type { ModuleContext } from '@so/sdk';
import { createOntologyService } from '@so/ontology';

interface Provider { complete(prompt: string): Promise<string>; }

function echoProvider(): Provider {
  return { async complete(prompt: string): Promise<string> { return `echo: ${prompt.slice(0, 2000)}`; } };
}

function httpProvider(endpoint: string): Provider {
  return {
    async complete(prompt: string): Promise<string> {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt }) });
      if (!res.ok) throw new Error(`AIP provider error: ${res.status}`);
      const data = (await res.json()) as { completion?: string };
      return data.completion ?? '';
    },
  };
}

export function createAipService(ctx: ModuleContext) {
  const ontology = createOntologyService(ctx);

  function provider(): Provider {
    const kind = ctx.config.get('AIP_PROVIDER') ?? 'echo';
    if (kind === 'http') return httpProvider(ctx.config.require('AIP_ENDPOINT'));
    return echoProvider();
  }

  async function complete(prompt: string): Promise<string> {
    return provider().complete(prompt);
  }

  async function ask(orgId: string, objectType: string, question: string): Promise<string> {
    const objects = await ontology.resolveObjects(orgId, objectType, { limit: 50 });
    const prompt =
      `You are analyzing ${objectType} objects.\n` +
      `Data: ${JSON.stringify(objects).slice(0, 4000)}\n` +
      `Question: ${question}\nAnswer:`;
    return provider().complete(prompt);
  }

  return { complete, ask };
}
```

- [ ] **Step 6: `packages/aip/src/routes.ts`**
```ts
import type { FastifyPluginAsync } from 'fastify';
import { requirePermission } from '@so/auth';
import { createAipService } from './service.js';

export const aipRoutes: FastifyPluginAsync = async (fastify) => {
  const svc = createAipService(fastify.ctx);

  fastify.post('/complete', { preHandler: requirePermission('aip:use') }, async (req, reply) => {
    const body = req.body as { prompt?: string };
    if (!body?.prompt) return reply.code(400).send({ error: 'prompt required' });
    return { completion: await svc.complete(body.prompt) };
  });

  fastify.post('/ask', { preHandler: requirePermission('aip:use') }, async (req, reply) => {
    const body = req.body as { objectType?: string; question?: string };
    if (!body?.objectType || !body?.question) return reply.code(400).send({ error: 'objectType and question required' });
    try { return { answer: await svc.ask(req.user!.orgId, body.objectType, body.question) }; }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });
};
```

- [ ] **Step 7: `packages/aip/src/index.ts`**
```ts
import { defineModule } from '@so/sdk';
import { aipRoutes } from './routes.js';

export default defineModule({
  id: 'aip',
  dependsOn: ['ontology', 'auth'],
  contributes: { apiRoutes: aipRoutes, permissions: ['aip:use'] },
});

export { createAipService } from './service.js';
```

- [ ] **Step 8: `packages/aip/test/aip.int.test.ts`**
```ts
import { describe, it, expect, afterAll } from 'vitest';
import { createServer, createConfig, type AppServer } from '@so/server';
import { createLogger } from '@so/observability';
import authModule from '@so/auth';
import datasetsModule from '@so/datasets';
import ontologyModule from '@so/ontology';
import aipModule from '../src/index.js';

const config = createConfig({
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so',
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'localhost:9000', S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin', S3_BUCKET: process.env.S3_BUCKET ?? 'so-datasets',
  ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: 'admin', // AIP_PROVIDER unset -> echo
});
const OT = 'AipFlight';
let server: AppServer;
afterAll(async () => { await server?.stop(); });
function cookieFrom(s: string | string[] | undefined): string { const raw = Array.isArray(s) ? s[0]! : s!; return raw.split(';')[0]!; }

describe('aip: gateway (echo) + ask over the ontology', () => {
  it('completes a prompt and answers over resolved objects', async () => {
    server = await createServer({ modules: [authModule, datasetsModule, ontologyModule, aipModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();
    const db = server.kernel.ctx.db;
    await db.query(`DELETE FROM object_properties WHERE object_type_id IN (SELECT id FROM object_types WHERE org_id='org_default' AND api_name=$1)`, [OT]);
    await db.query(`DELETE FROM object_types WHERE org_id='org_default' AND api_name=$1`, [OT]);

    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const auth = { cookie: cookieFrom(login.headers['set-cookie']) };

    const comp = await server.app.inject({ method: 'POST', url: '/api/aip/complete', headers: auth, payload: { prompt: 'ping' } });
    expect(comp.statusCode).toBe(200);
    expect(comp.json().completion).toBe('echo: ping');

    const up = await server.app.inject({ method: 'POST', url: '/api/datasets?name=aipds&format=csv', headers: { ...auth, 'content-type': 'text/csv' }, payload: 'flight_no,status\nFL-204,Delayed\n' });
    const datasetId = up.json().dataset.id as string;
    await server.app.inject({ method: 'POST', url: '/api/ontology/object-types', headers: auth, payload: { apiName: OT, datasetId, primaryKey: 'flightNumber', properties: [ { apiName: 'flightNumber', column: 'flight_no', type: 'string' }, { apiName: 'status', column: 'status', type: 'string' } ] } });

    const ask = await server.app.inject({ method: 'POST', url: '/api/aip/ask', headers: auth, payload: { objectType: OT, question: 'how many flights?' } });
    expect(ask.statusCode).toBe(200);
    const answer = ask.json().answer as string;
    expect(answer).toContain('how many flights?'); // echo of the prompt
    expect(answer).toContain('FL-204');             // the resolved object data was in the context

    const noauth = await server.app.inject({ method: 'POST', url: '/api/aip/complete', payload: { prompt: 'x' } });
    expect(noauth.statusCode).toBe(401);
  });
});
```

- [ ] **Step 9: Run with infra up → PASS:** `pnpm run infra:up && pnpm --filter @so/aip test` (timeout 180000). Then `pnpm --filter @so/aip run typecheck` clean. No unused imports.

- [ ] **Step 10: Commit:** `git add -A && git commit -m "feat(aip): LLM gateway + ask-over-ontology (echo default, optional http provider)"`

---

## Task 2: Full verification + merge
- [ ] `pnpm run infra:up && pnpm run infra:seed && pnpm typecheck && pnpm lint && pnpm test` → green; `git checkout main && git merge --ff-only phase15/module-aip`

---

## Self-review
- **Spec §13 Phase 4 (AIP)** — LLM gateway + semantic question-answering over the ontology (resolves object set → context → completion). ✓
- **Air-gap (§9)** — default `echo` provider makes no external calls; the `http` provider is opt-in via `AIP_PROVIDER`/`AIP_ENDPOINT`, pointable at a local model. Zero phone-home by default. ✓
- **Additive** — new package; no merged changes. ✓
- **Deferred:** streaming, real embeddings/vector semantic search, agents that call actions/functions as tools, prompt templates, token budgeting, provider auth headers. Flagged (agents = next AIP plan).
