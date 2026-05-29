# Phase 10 (2.1) — module-functions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** Derived/computed properties on Object Types — e.g. `isDelayed = (status = 'Delayed')`. Computed during resolution by DuckDB over the already-resolved properties, returned alongside the mapped properties.

**Architecture:** A **backward-compatible** extension to `@so/query`'s resolver: `ObjectTypeMapping` gains an optional `functions` list; `buildResolveSql` adds computed columns to the OUTER select over the existing `resolved` CTE (with no functions, the SQL is byte-identical to today, so all existing tests stay green). `@so/ontology` stores function defs (`object_functions` table), includes them in `getObjectType`, and passes them to the resolver in `resolveObjects`. A route defines them.

**Tech Stack:** TypeScript, DuckDB expressions (admin-defined, guarded), consuming `@so/query`/`@so/auth`; integration-tested via `@so/server`.

---

## Pre-flight
- [ ] **Branch:** `cd /Users/sumitagrawal/CODE/sumit/SoftwareOntology && git checkout main && git checkout -b phase10/module-functions`

---

## Task 1: `@so/query` — computed columns (backward-compatible)

**Files:** Modify `packages/query/src/types.ts`, `packages/query/src/sql.ts`, `packages/query/test/sql.test.ts`

- [ ] **Step 1: Add `FunctionDef` + extend `ObjectTypeMapping` — modify `packages/query/src/types.ts`**

Add the interface and the optional field:
```ts
export interface FunctionDef {
  /** Computed property name, e.g. "isDelayed" */
  name: string;
  /** DuckDB SQL expression over resolved property names, e.g. "status = 'Delayed'" */
  expression: string;
  type: PropType;
}
```
And in `ObjectTypeMapping`, add `functions` right before `backing`:
```ts
  functions?: FunctionDef[];
  backing: { kind: 'localFile' | 's3'; path: string };
```

- [ ] **Step 2: Write the failing unit test — append to `packages/query/test/sql.test.ts`**

```ts
describe('buildResolveSql with functions', () => {
  const withFn: ObjectTypeMapping = {
    ...flight,
    functions: [{ name: 'isDelayed', expression: "status = 'Delayed'", type: 'bool' }],
  };
  it('adds a CAST computed column over the resolved CTE', () => {
    const { sql } = buildResolveSql(withFn, 'pg', {});
    expect(sql).toContain('FROM resolved');
    expect(sql).toContain(`CAST((status = 'Delayed') AS BOOLEAN) AS "isDelayed"`);
  });
  it('is byte-identical to no-functions when functions is empty/absent', () => {
    const a = buildResolveSql(flight, 'pg', {}).sql;
    const b = buildResolveSql({ ...flight, functions: [] }, 'pg', {}).sql;
    expect(a).toBe(b);
  });
  it('rejects dangerous expressions', () => {
    expect(() => buildResolveSql({ ...flight, functions: [{ name: 'x', expression: 'status; DROP TABLE users', type: 'string' }] }, 'pg', {})).toThrow();
  });
});
```

- [ ] **Step 3: Run → FAIL:** `pnpm --filter @so/query test sql` (the new assertions fail / functions not handled)

- [ ] **Step 4: Implement in `packages/query/src/sql.ts`**

Add near the top (after `ALLOWED_OPS`):
```ts
const SAFE_EXPR = /^[A-Za-z0-9_\s'".,()<>=!+\-*/%|&:]+$/;
function guardExpression(expr: string): void {
  if (expr.length > 500) throw new Error('function expression too long');
  if (expr.includes(';') || expr.includes('--') || expr.includes('/*')) throw new Error('illegal characters in function expression');
  if (!SAFE_EXPR.test(expr)) throw new Error('disallowed characters in function expression');
}
```
Then, in `buildResolveSql`, immediately before building the final `sql` string, compute the projection:
```ts
  const funcCols = (m.functions ?? [])
    .map((f) => {
      guardExpression(f.expression);
      return `CAST((${f.expression}) AS ${DUCK_TYPE[f.type]}) AS "${ident(f.name)}"`;
    })
    .join(', ');
  const projection = funcCols ? `*, ${funcCols}` : '*';
```
And change the outer select line from `SELECT * FROM resolved` to:
```ts
SELECT ${projection} FROM resolved
```
(Everything else — the CTE, WHERE, ORDER BY, LIMIT — unchanged.)

- [ ] **Step 5: Run → PASS:** `pnpm --filter @so/query test` — the new sql tests pass AND all existing `@so/query` tests (7) still pass (no-functions path is byte-identical). Then `pnpm --filter @so/query run typecheck` clean.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(query): optional computed columns (FunctionDef) — backward-compatible"
```

---

## Task 2: `@so/ontology` — function defs + resolution + route

**Files:** Modify `packages/ontology/src/migrate.ts`, `packages/ontology/src/service.ts`, `packages/ontology/src/routes.ts`; Create `packages/ontology/test/functions.int.test.ts`

- [ ] **Step 1: Add the table — modify `packages/ontology/src/migrate.ts`**

Append to the `MIGRATIONS` array (after `link_types`, before the overlay tables is fine — order only matters for FKs; this references `object_types`):
```ts
  `CREATE TABLE IF NOT EXISTS object_functions (
     object_type_id text NOT NULL REFERENCES object_types(id),
     ordinal int NOT NULL,
     api_name text NOT NULL,
     expression text NOT NULL,
     prop_type text NOT NULL,
     PRIMARY KEY (object_type_id, ordinal)
   )`,
```

- [ ] **Step 2: Extend the service — modify `packages/ontology/src/service.ts`**

Add `FunctionDef` to the `@so/query` import (it's exported there):
```ts
import { resolveObjectSet, type ObjectTypeMapping, type PropType, type Filter, type FunctionDef } from '@so/query';
```
Add a `functions` field to `ObjectTypeDetail`:
```ts
export interface ObjectTypeDetail extends ObjectTypeSummary { id: string; objectKey: string; properties: PropertyInput[]; functions: FunctionInput[]; }
export interface FunctionInput { apiName: string; expression: string; type: PropType; }
```
In `getObjectType`, after loading `props`, load functions and include them:
```ts
    const fns = await ctx.db.query<{ api_name: string; expression: string; prop_type: string }>(
      `SELECT api_name, expression, prop_type FROM object_functions WHERE object_type_id = $1 ORDER BY ordinal`,
      [r.id],
    );
```
and in the returned object add:
```ts
      functions: fns.map((f) => ({ apiName: f.api_name, expression: f.expression, type: f.prop_type as PropType })),
```
Add a `createFunction` function inside `createOntologyService`:
```ts
  async function createFunction(orgId: string, objectType: string, input: FunctionInput): Promise<void> {
    if (!NAME_RE.test(input.apiName)) throw new Error(`invalid function name: ${input.apiName}`);
    if (!VALID_TYPES.has(input.type)) throw new Error(`invalid type: ${input.type}`);
    const ot = await getObjectType(orgId, objectType);
    if (!ot) throw new Error(`object type not found: ${objectType}`);
    const ordinal = ot.functions.length;
    await ctx.db.query(
      `INSERT INTO object_functions(object_type_id,ordinal,api_name,expression,prop_type) VALUES ($1,$2,$3,$4,$5)`,
      [ot.id, ordinal, input.apiName, input.expression, input.type],
    );
  }
```
In `resolveObjects`, add `functions` to the mapping it builds:
```ts
    const mapping: ObjectTypeMapping = {
      objectType: ot.apiName,
      primaryKey: ot.primaryKey,
      properties: ot.properties.map((p) => ({ name: p.apiName, column: p.column, type: p.type })),
      functions: ot.functions.map((f) => ({ name: f.apiName, expression: f.expression, type: f.type })),
      backing: { kind: 's3', path: ctx.objectStore.getObjectUrl(ot.objectKey) },
    };
```
Add `createFunction` to the returned object: `return { createObjectType, listObjectTypes, getObjectType, createLinkType, resolveObjects, createFunction };`
Export the new type: `export { createOntologyService, type ObjectTypeInput, type ObjectTypeDetail, type FunctionInput } ...` (update `index.ts` if it re-exports).

- [ ] **Step 3: Add the route — modify `packages/ontology/src/routes.ts`**

Import `FunctionInput` from the service and add this route inside `ontologyRoutes`:
```ts
  fastify.post('/object-types/:apiName/functions', { preHandler: requirePermission('ontology:edit') }, async (req, reply) => {
    const { apiName } = req.params as { apiName: string };
    const body = req.body as { apiName?: string; expression?: string; type?: string };
    if (!body?.apiName || !body?.expression || !body?.type) {
      return reply.code(400).send({ error: 'apiName, expression, type required' });
    }
    try {
      await svc.createFunction(req.user!.orgId, apiName, { apiName: body.apiName, expression: body.expression, type: body.type as never });
      return reply.code(201).send({ ok: true });
    } catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });
```

- [ ] **Step 4: Create `packages/ontology/test/functions.int.test.ts`**

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { createServer, createConfig, type AppServer } from '@so/server';
import { createLogger } from '@so/observability';
import authModule from '@so/auth';
import datasetsModule from '@so/datasets';
import ontologyModule from '../src/index.js';

const config = createConfig({
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so',
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'localhost:9000',
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin',
  S3_BUCKET: process.env.S3_BUCKET ?? 'so-datasets',
  ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: 'admin',
});

const OT = 'FlightFn';
let server: AppServer;
afterAll(async () => { await server?.stop(); });
function cookieFrom(s: string | string[] | undefined): string { const raw = Array.isArray(s) ? s[0]! : s!; return raw.split(';')[0]!; }

describe('ontology functions: computed properties', () => {
  it('resolves a computed boolean property', async () => {
    server = await createServer({ modules: [authModule, datasetsModule, ontologyModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();
    const db = server.kernel.ctx.db;
    await db.query(`DELETE FROM object_functions WHERE object_type_id IN (SELECT id FROM object_types WHERE org_id='org_default' AND api_name=$1)`, [OT]);
    await db.query(`DELETE FROM object_properties WHERE object_type_id IN (SELECT id FROM object_types WHERE org_id='org_default' AND api_name=$1)`, [OT]);
    await db.query(`DELETE FROM object_types WHERE org_id='org_default' AND api_name=$1`, [OT]);

    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const auth = { cookie: cookieFrom(login.headers['set-cookie']) };

    const up = await server.app.inject({ method: 'POST', url: '/api/datasets?name=flightsfn&format=csv', headers: { ...auth, 'content-type': 'text/csv' }, payload: 'flight_no,status\nFL-204,Delayed\nFL-118,Boarding\n' });
    const datasetId = up.json().dataset.id as string;
    await server.app.inject({ method: 'POST', url: '/api/ontology/object-types', headers: auth, payload: { apiName: OT, datasetId, primaryKey: 'flightNumber', properties: [ { apiName: 'flightNumber', column: 'flight_no', type: 'string' }, { apiName: 'status', column: 'status', type: 'string' } ] } });

    const fn = await server.app.inject({ method: 'POST', url: `/api/ontology/object-types/${OT}/functions`, headers: auth, payload: { apiName: 'isDelayed', expression: "status = 'Delayed'", type: 'bool' } });
    expect(fn.statusCode).toBe(201);

    const objs = await server.app.inject({ method: 'GET', url: `/api/ontology/object-types/${OT}/objects`, headers: auth });
    const rows = objs.json().objects as Array<{ flightNumber: string; isDelayed: boolean }>;
    expect(rows.find((r) => r.flightNumber === 'FL-204')?.isDelayed).toBe(true);
    expect(rows.find((r) => r.flightNumber === 'FL-118')?.isDelayed).toBe(false);
  });
});
```

- [ ] **Step 5: Run with infra up → PASS:** `pnpm run infra:up && pnpm --filter @so/ontology test` (Bash timeout 180000). Then `pnpm --filter @so/ontology run typecheck` clean.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(ontology): computed function properties (define + resolve)"
```

---

## Task 3: Full verification + merge

- [ ] **Step 1:** `pnpm run infra:up && pnpm run infra:seed && pnpm typecheck && pnpm lint && pnpm test` → expect **55 tests** (prior 53 + query sql 3 grouped as... count may vary; the key: all green, no regressions). Confirm the exact new total and that nothing regressed.
- [ ] **Step 2:** `git checkout main && git merge --ff-only phase10/module-functions`

---

## Self-review
- **Spec §6 (Functions / derived logic)** — computed properties defined per object type, evaluated in resolution. ✓
- **Backward compatibility** — `functions` optional; no-functions SQL byte-identical (asserted in a test) → zero regression risk to existing resolution/actions. ✓
- **Security** — function expressions are `ontology:edit`-gated (admin), guarded (no `;`/`--`/`/*`, charset allowlist, length cap), CAST to the declared type, evaluated read-only over the `resolved` CTE. ✓
- **Type consistency** — `FunctionDef` (query) ↔ `FunctionInput` (ontology); `createFunction`/`getObjectType.functions`/`resolveObjects` aligned. ✓
- **Deferred:** filtering/sorting on computed columns (WHERE can't see outer aliases — needs a wrapping subquery; later), function expressions referencing links/aggregations (Phase 3+), a UI for functions. Flagged.
