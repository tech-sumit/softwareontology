# Phase 18 (2.6) — Property-level RLS Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps `- [ ]`.

**Goal:** Property-level security. A property can require a permission; the `/objects` route masks (omits) that property for users who lack it. Admin (`*`) sees everything.

**Architecture:** Modifies merged `@so/ontology` (additively): an idempotent `ALTER TABLE … ADD COLUMN` for `required_permission`, `getObjectType` returns it, a route sets it, and the `/objects` route masks after resolution using `hasPermission` from `@so/auth`. Backward-compatible: with no secured properties, behavior is unchanged (existing ontology/functions tests stay green).

> **Note:** this is response-level property masking (the value is computed then omitted), not query-level RLS. Sufficient for Phase 1/2; query-level pushdown deferred.

---

## Pre-flight
- [ ] **Branch:** `git checkout main && git checkout -b phase18/property-rls`

---

## Task 1: Ontology RLS

**Files:** Modify `packages/ontology/src/migrate.ts`, `packages/ontology/src/service.ts`, `packages/ontology/src/routes.ts`; Create `packages/ontology/test/rls.int.test.ts`; Modify `packages/ontology/package.json` (devDep already has what's needed)

- [ ] **Step 1: Add the column — modify `packages/ontology/src/migrate.ts`**

Append to the `MIGRATIONS` array (after `object_functions`):
```ts
  `ALTER TABLE object_properties ADD COLUMN IF NOT EXISTS required_permission text`,
```

- [ ] **Step 2: Extend the service — modify `packages/ontology/src/service.ts`**

Add `requiredPermission` to `PropertyInput`:
```ts
export interface PropertyInput { apiName: string; column: string; type: PropType; requiredPermission?: string | null; }
```
In `getObjectType`, change the properties query to also select `required_permission` and map it. Replace the `props` query + the `properties:` mapping in the returned object:
```ts
    const props = await ctx.db.query<{ api_name: string; column_name: string; prop_type: string; required_permission: string | null }>(
      `SELECT api_name, column_name, prop_type, required_permission FROM object_properties WHERE object_type_id = $1 ORDER BY ordinal`,
      [r.id],
    );
```
and in the returned object:
```ts
      properties: props.map((p) => ({ apiName: p.api_name, column: p.column_name, type: p.prop_type as PropType, requiredPermission: p.required_permission })),
```
Add a `setPropertySecurity` method inside `createOntologyService`:
```ts
  async function setPropertySecurity(orgId: string, objectType: string, propertyApiName: string, requiredPermission: string | null): Promise<void> {
    const ot = await getObjectType(orgId, objectType);
    if (!ot) throw new Error(`object type not found: ${objectType}`);
    if (!ot.properties.some((p) => p.apiName === propertyApiName)) throw new Error(`property not found: ${propertyApiName}`);
    await ctx.db.query(
      `UPDATE object_properties SET required_permission = $1 WHERE object_type_id = $2 AND api_name = $3`,
      [requiredPermission, ot.id, propertyApiName],
    );
  }
```
Add it to the returned object: `return { createObjectType, listObjectTypes, getObjectType, createLinkType, resolveObjects, createFunction, setPropertySecurity };`

> Note: `resolveObjects` builds the mapping from `ot.properties` using only `name/column/type` — leave it unchanged (masking happens in the route, not the resolver). The extra `requiredPermission` field on `PropertyInput` is optional and ignored there.

- [ ] **Step 3: Mask in the route + add the security route — modify `packages/ontology/src/routes.ts`**

Add `hasPermission` to the `@so/auth` import:
```ts
import { requirePermission, hasPermission } from '@so/auth';
```
Replace the `/object-types/:apiName/objects` handler body with a version that masks:
```ts
  fastify.get('/object-types/:apiName/objects', { preHandler: requirePermission('ontology:read') }, async (req, reply) => {
    const { apiName } = req.params as { apiName: string };
    const q = req.query as { limit?: string; offset?: string };
    try {
      const ot = await svc.getObjectType(req.user!.orgId, apiName);
      if (!ot) return reply.code(404).send({ error: 'not found' });
      const perms = req.user!.permissions;
      const masked = ot.properties.filter((p) => p.requiredPermission && !hasPermission(perms, p.requiredPermission)).map((p) => p.apiName);
      const objects = await svc.resolveObjects(req.user!.orgId, apiName, { limit: Number(q.limit ?? 100), offset: Number(q.offset ?? 0) });
      const result = masked.length === 0 ? objects : objects.map((o) => { for (const m of masked) delete o[m]; return o; });
      return { objects: result };
    } catch (e) {
      return reply.code(404).send({ error: (e as Error).message });
    }
  });
```
Add a security route inside `ontologyRoutes`:
```ts
  fastify.post('/object-types/:apiName/properties/:propName/security', { preHandler: requirePermission('ontology:edit') }, async (req, reply) => {
    const { apiName, propName } = req.params as { apiName: string; propName: string };
    const body = req.body as { requiredPermission?: string | null };
    try {
      await svc.setPropertySecurity(req.user!.orgId, apiName, propName, body?.requiredPermission ?? null);
      return reply.code(200).send({ ok: true });
    } catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });
```

- [ ] **Step 4: Create `packages/ontology/test/rls.int.test.ts`**

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createServer, createConfig, type AppServer } from '@so/server';
import { createLogger } from '@so/observability';
import authModule, { hashPassword } from '@so/auth';
import datasetsModule from '@so/datasets';
import ontologyModule from '../src/index.js';

const config = createConfig({
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so',
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'localhost:9000', S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin', S3_BUCKET: process.env.S3_BUCKET ?? 'so-datasets',
  ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: 'admin',
});
const OT = 'EmployeeRls';
let server: AppServer;
afterAll(async () => { await server?.stop(); });
function cookieFrom(s: string | string[] | undefined): string { const raw = Array.isArray(s) ? s[0]! : s!; return raw.split(';')[0]!; }

describe('property-level RLS: secured property is masked for users without the permission', () => {
  it('admin sees salary; a limited user does not', async () => {
    server = await createServer({ modules: [authModule, datasetsModule, ontologyModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();
    const db = server.kernel.ctx.db;
    // isolation
    await db.query(`DELETE FROM object_properties WHERE object_type_id IN (SELECT id FROM object_types WHERE org_id='org_default' AND api_name=$1)`, [OT]);
    await db.query(`DELETE FROM object_types WHERE org_id='org_default' AND api_name=$1`, [OT]);
    await db.query(`DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE email='limited@example.com')`);
    await db.query(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email='limited@example.com')`);
    await db.query(`DELETE FROM users WHERE email='limited@example.com'`);
    await db.query(`DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE name='limitedrole')`);
    await db.query(`DELETE FROM roles WHERE name='limitedrole'`);

    const adminLogin = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const admin = { cookie: cookieFrom(adminLogin.headers['set-cookie']) };

    const up = await server.app.inject({ method: 'POST', url: '/api/datasets?name=rlsds&format=csv', headers: { ...admin, 'content-type': 'text/csv' }, payload: 'emp_no,name,salary\nE1,Alice,100\n' });
    const datasetId = up.json().dataset.id as string;
    await server.app.inject({ method: 'POST', url: '/api/ontology/object-types', headers: admin, payload: { apiName: OT, datasetId, primaryKey: 'empNo', properties: [ { apiName: 'empNo', column: 'emp_no', type: 'string' }, { apiName: 'name', column: 'name', type: 'string' }, { apiName: 'salary', column: 'salary', type: 'int' } ] } });
    await server.app.inject({ method: 'POST', url: `/api/ontology/object-types/${OT}/properties/salary/security`, headers: admin, payload: { requiredPermission: 'pii:view' } });

    // admin (perm '*') sees salary
    const adminObjs = await server.app.inject({ method: 'GET', url: `/api/ontology/object-types/${OT}/objects`, headers: admin });
    const aRow = (adminObjs.json().objects as Array<Record<string, unknown>>)[0]!;
    expect(aRow.salary).toBe(100);
    expect(aRow.name).toBe('Alice');

    // create a limited user (role with only ontology:read) directly
    const roleId = randomUUID(); const userId = randomUUID();
    await db.query(`INSERT INTO roles(id,org_id,name) VALUES ($1,'org_default','limitedrole')`, [roleId]);
    await db.query(`INSERT INTO permissions(key) VALUES ('ontology:read') ON CONFLICT DO NOTHING`);
    await db.query(`INSERT INTO role_permissions(role_id,permission_key) VALUES ($1,'ontology:read')`, [roleId]);
    await db.query(`INSERT INTO users(id,org_id,email,password_hash) VALUES ($1,'org_default','limited@example.com',$2)`, [userId, hashPassword('pw')]);
    await db.query(`INSERT INTO user_roles(user_id,role_id) VALUES ($1,$2)`, [userId, roleId]);

    const limLogin = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'limited@example.com', password: 'pw' } });
    const lim = { cookie: cookieFrom(limLogin.headers['set-cookie']) };
    const limObjs = await server.app.inject({ method: 'GET', url: `/api/ontology/object-types/${OT}/objects`, headers: lim });
    const lRow = (limObjs.json().objects as Array<Record<string, unknown>>)[0]!;
    expect(lRow.name).toBe('Alice');     // unsecured property visible
    expect('salary' in lRow).toBe(false); // secured property masked
  });
});
```

- [ ] **Step 5: Run the FULL ontology suite (regression check) with infra up → PASS:**

```bash
pnpm run infra:up && pnpm --filter @so/ontology test
```
Expected: the 3 existing ontology tests (ontology.int, functions.int, and others) still pass PLUS the new rls test — masking only applies to secured properties, so existing tests are unaffected. (timeout 180000). Then `pnpm --filter @so/ontology run typecheck` clean. No unused imports.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(ontology): property-level RLS (per-property required permission + masking)"
```

---

## Task 2: Full verification + merge
- [ ] `pnpm run infra:up && pnpm run infra:seed && pnpm typecheck && pnpm lint && pnpm test` → green; `git checkout main && git merge --ff-only phase18/property-rls`

---

## Self-review
- **Spec §8 (property-level RLS)** — per-property required permission; masked at the response for users lacking it; admin `*` unaffected. ✓
- **Backward-compatible** — additive `ALTER … IF NOT EXISTS`; no-secured-property path unchanged; existing ontology/functions tests must stay green. ✓
- **Reuses** `hasPermission` (auth) + the existing RBAC; limited user created via the real auth tables + scrypt hash. ✓
- **Deferred:** query-level (pushdown) RLS, row-level security (filtering rows by predicate), masking in `resolveObjects` for non-HTTP callers, a UI. Flagged.
