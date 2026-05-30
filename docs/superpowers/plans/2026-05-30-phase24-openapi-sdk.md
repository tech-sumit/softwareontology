# Phase 24 (#9) — OpenAPI Spec + Generated Typed SDK Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps `- [ ]`.

**Goal:** Publish an **OpenAPI 3.1 spec** for the platform API (served at `/api/openapi/spec`), and generate a **fully-typed client SDK** (`@so/client`) from it using `openapi-typescript` + `openapi-fetch` (the "spec generator" pipeline). The spec is the artifact any OpenAPI codegen tool (openapi-typescript, openapi-generator, orval) can consume — that's the leverage.

**Architecture:** `@so/openapi` exports a hand-authored, accurate spec (covering the core surface: auth, datasets, ontology, actions) and serves it via a public route. A root `gen:client` script runs `openapi-typescript` over the spec → `packages/client/src/schema.ts` (committed). `@so/client` wraps `openapi-fetch` with that schema for a typed client.

> Scope: core endpoints first (the SDK surface that matters); the spec is structured so more paths are added incrementally.

---

## Pre-flight
- [ ] **Branch:** `git checkout main && git checkout -b phase24/openapi-sdk`

---

## Task 1: `@so/openapi` (spec + serve)

**Files:** Create `packages/openapi/{package.json,tsconfig.json,vitest.config.ts,src/spec.ts,src/index.ts,test/openapi.int.test.ts}`

- [ ] **Step 1: `packages/openapi/package.json`**
```json
{
  "name": "@so/openapi", "version": "0.0.0", "private": true, "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "dependencies": { "@so/sdk": "workspace:*", "fastify": "^5.2.0" },
  "devDependencies": { "@so/server": "workspace:*", "@so/observability": "workspace:*", "@so/auth": "workspace:*", "@types/node": "^22.10.0" }
}
```

- [ ] **Step 2: `pnpm install`**

- [ ] **Step 3: `packages/openapi/tsconfig.json`**
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "outDir": "dist", "types": ["node"] }, "include": ["src/**/*", "test/**/*"] }
```

- [ ] **Step 4: `packages/openapi/vitest.config.ts`**
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { testTimeout: 60_000, hookTimeout: 60_000 } });
```

- [ ] **Step 5: Create `packages/openapi/src/spec.ts`** (accurate core spec)
```ts
export const openapiSpec = {
  openapi: '3.1.0',
  info: { title: 'SoftwareOntology API', version: '1.0.0', description: 'Open-source Foundry-alternative platform API' },
  servers: [{ url: '/api' }],
  paths: {
    '/auth/login': { post: { operationId: 'login', requestBody: jsonBody({ email: str(), password: str() }, ['email', 'password']), responses: ok({ ok: bool() }) } },
    '/auth/me': { get: { operationId: 'me', responses: ok({ user: ref('User') }) } },
    '/auth/logout': { post: { operationId: 'logout', responses: ok({ ok: bool() }) } },
    '/datasets': { get: { operationId: 'listDatasets', responses: ok({ datasets: arr(ref('Dataset')) }) } },
    '/datasets/{id}/preview': { get: { operationId: 'previewDataset', parameters: [pathParam('id')], responses: ok({ rows: arr(obj()) }) } },
    '/ontology/object-types': {
      get: { operationId: 'listObjectTypes', responses: ok({ objectTypes: arr(ref('ObjectTypeSummary')) }) },
      post: { operationId: 'createObjectType', requestBody: jsonBody({ apiName: str(), datasetId: str(), primaryKey: str(), properties: arr(ref('PropertyInput')) }, ['apiName', 'datasetId', 'primaryKey', 'properties']), responses: created({ objectType: ref('ObjectTypeSummary') }) },
    },
    '/ontology/object-types/{apiName}/objects': { get: { operationId: 'getObjects', parameters: [pathParam('apiName')], responses: ok({ objects: arr(obj()) }) } },
    '/actions/{apiName}/execute': { post: { operationId: 'executeAction', parameters: [pathParam('apiName')], requestBody: jsonBody({ primaryKey: str(), edits: obj() }, ['primaryKey']), responses: ok({ ok: bool() }) } },
  },
  components: {
    schemas: {
      User: object({ id: str(), orgId: str(), email: str(), permissions: arr(str()) }, ['id', 'orgId', 'email', 'permissions']),
      Dataset: object({ id: str(), name: str(), rowCount: num() }, ['id', 'name', 'rowCount']),
      ObjectTypeSummary: object({ apiName: str(), primaryKey: str() }, ['apiName', 'primaryKey']),
      PropertyInput: object({ apiName: str(), column: str(), type: str() }, ['apiName', 'column', 'type']),
    },
  },
} as const;

// minimal OpenAPI schema helpers (kept tiny + typed-friendly for openapi-typescript)
function str() { return { type: 'string' } as const; }
function num() { return { type: 'number' } as const; }
function bool() { return { type: 'boolean' } as const; }
function obj() { return { type: 'object', additionalProperties: true } as const; }
function arr(items: object) { return { type: 'array', items }; }
function ref(name: string) { return { $ref: `#/components/schemas/${name}` }; }
function object(properties: Record<string, object>, required: string[]) { return { type: 'object', properties, required }; }
function pathParam(name: string) { return { name, in: 'path', required: true, schema: { type: 'string' } }; }
function jsonBody(properties: Record<string, object>, required: string[]) { return { required: true, content: { 'application/json': { schema: { type: 'object', properties, required } } } }; }
function ok(properties: Record<string, object>) { return { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'object', properties } } } } }; }
function created(properties: Record<string, object>) { return { '201': { description: 'created', content: { 'application/json': { schema: { type: 'object', properties } } } } }; }
```

- [ ] **Step 6: Create `packages/openapi/src/index.ts`**
```ts
import { defineModule } from '@so/sdk';
import type { FastifyPluginAsync } from 'fastify';
import { openapiSpec } from './spec.js';

const routes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/spec', async () => openapiSpec);
};

export default defineModule({ id: 'openapi', contributes: { apiRoutes: routes } });
export { openapiSpec } from './spec.js';
```

- [ ] **Step 7: Create `packages/openapi/test/openapi.int.test.ts`**
```ts
import { describe, it, expect, afterAll } from 'vitest';
import { createServer, createConfig, type AppServer } from '@so/server';
import { createLogger } from '@so/observability';
import openapiModule from '../src/index.js';

const config = createConfig({ DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so', S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'localhost:9000', S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin', S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin', S3_BUCKET: process.env.S3_BUCKET ?? 'so-datasets' });
let server: AppServer;
afterAll(async () => { await server?.stop(); });

describe('openapi: spec is served', () => {
  it('serves a valid OpenAPI 3.1 document', async () => {
    server = await createServer({ modules: [openapiModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();
    const res = await server.app.inject({ method: 'GET', url: '/api/openapi/spec' });
    expect(res.statusCode).toBe(200);
    const spec = res.json();
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.paths['/auth/login'].post.operationId).toBe('login');
    expect(spec.components.schemas.User).toBeDefined();
  });
});
```

- [ ] **Step 8: Run → PASS:** `pnpm run infra:up && pnpm --filter @so/openapi test` (timeout 120000). typecheck clean; no unused imports.

- [ ] **Step 9: Commit:** `git add -A && git commit -m "feat(openapi): served OpenAPI 3.1 spec for the platform API"`

---

## Task 2: `@so/client` (generated typed SDK)

**Files:** Create `packages/client/{package.json,tsconfig.json,vitest.config.ts,src/index.ts,src/schema.ts,test/client.test.ts}`; add a root `gen:client` script

- [ ] **Step 1: `packages/client/package.json`**
```json
{
  "name": "@so/client", "version": "0.0.0", "private": true, "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run", "gen": "node ./gen.mjs" },
  "dependencies": { "openapi-fetch": "^0.13.0" },
  "devDependencies": { "openapi-typescript": "^7.4.0", "@so/openapi": "workspace:*", "@types/node": "^22.10.0" }
}
```

- [ ] **Step 2: `pnpm install`**

- [ ] **Step 3: Create `packages/client/gen.mjs`** (writes spec → runs openapi-typescript)
```js
// Regenerate the typed schema from the served OpenAPI spec.
import { writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { openapiSpec } from '@so/openapi';

await writeFile(new URL('./openapi.json', import.meta.url), JSON.stringify(openapiSpec, null, 2));
execFileSync('pnpm', ['exec', 'openapi-typescript', new URL('./openapi.json', import.meta.url).pathname, '-o', new URL('./src/schema.ts', import.meta.url).pathname], { stdio: 'inherit' });
console.log('generated src/schema.ts');
```

- [ ] **Step 4: Generate the schema:** run `pnpm --filter @so/client exec node gen.mjs` (or `cd packages/client && node gen.mjs`). This creates `packages/client/src/schema.ts` and `packages/client/openapi.json`. Commit both. (If `openapi-typescript` CLI invocation differs, adjust gen.mjs to call it correctly and report; the goal is a generated `src/schema.ts` typed from the spec.)

- [ ] **Step 5: Create `packages/client/tsconfig.json`**
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "outDir": "dist", "types": ["node"] }, "include": ["src/**/*", "test/**/*"] }
```

- [ ] **Step 6: Create `packages/client/vitest.config.ts`**
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: {} });
```

- [ ] **Step 7: Create `packages/client/src/index.ts`** (typed client)
```ts
import createOpenapiClient from 'openapi-fetch';
import type { paths } from './schema.js';

/** A fully-typed SoftwareOntology API client generated from the OpenAPI spec. */
export function createClient(opts: { baseUrl: string }) {
  return createOpenapiClient<paths>({ baseUrl: opts.baseUrl, credentials: 'include' });
}
export type { paths } from './schema.js';
```

- [ ] **Step 8: Create `packages/client/test/client.test.ts`** (pure — no backend)
```ts
import { describe, it, expect } from 'vitest';
import { createClient } from '../src/index.js';

describe('@so/client', () => {
  it('constructs a typed client with GET/POST methods', () => {
    const client = createClient({ baseUrl: 'http://localhost:3000/api' });
    expect(typeof client.GET).toBe('function');
    expect(typeof client.POST).toBe('function');
  });
});
```

- [ ] **Step 9: Add root `gen:client` script — modify root `package.json` scripts:**
```json
    "gen:client": "pnpm --filter @so/client exec node gen.mjs"
```

- [ ] **Step 10: Run → PASS:** `pnpm --filter @so/client test` (1 test) + `pnpm --filter @so/client run typecheck` clean (proves the generated `schema.ts` + `openapi-fetch` types compile). No unused imports.

- [ ] **Step 11: Commit:** `git add -A && git commit -m "feat(client): generated typed SDK (openapi-typescript + openapi-fetch)"`

---

## Task 3: Full verification + merge
- [ ] `pnpm run infra:up && pnpm run infra:seed && pnpm typecheck; pnpm lint; pnpm test` (exit codes) → green; `git checkout main && git merge --ff-only phase24/openapi-sdk`

---

## Self-review
- **Spec §13 #9 (devex / SDK)** — OpenAPI spec published + a generated, fully-typed client SDK via the standard `openapi-typescript`/`openapi-fetch` pipeline; the spec feeds any OpenAPI generator. ✓
- **Air-gap** — spec served from our own server; codegen tools are dev-time, vendored via pnpm. ✓
- **Deferred:** full endpoint coverage in the spec (core covered; add remaining modules incrementally), auto-generating the spec from route schemas, Swagger-UI page, publishing the SDK to a registry. Flagged.
