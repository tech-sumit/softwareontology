# Phase 21 (#3.1) — Ontology Link Traversal Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps `- [ ]`.

**Goal:** Traverse links. Given an object, resolve the objects on the other side of a link type (many-to-one): `Flight → Aircraft` via `Flight.tailNo = Aircraft.tailNumber`. Link types are already stored (Plan 6) but not traversable; this adds resolution.

**Architecture:** Additive to `@so/ontology` (merged) — a `resolveLinkedObjects` service method (reuses `getObjectType` + `resolveObjects` + the resolver's filters) and a route. No new tables. Backward-compatible.

---

## Pre-flight
- [ ] **Branch:** already on `phase21/ontology-link-traversal` (created with BACKLOG.md). If not: `git checkout main && git checkout -b phase21/ontology-link-traversal`.

---

## Task 1: Link traversal in `@so/ontology`

**Files:** Modify `packages/ontology/src/service.ts`, `packages/ontology/src/routes.ts`; Create `packages/ontology/test/links.int.test.ts`

- [ ] **Step 1: Add `resolveLinkedObjects` — modify `packages/ontology/src/service.ts`**

Add inside `createOntologyService` (after `createLinkType`):
```ts
  async function resolveLinkedObjects(orgId: string, fromType: string, fromPk: string, linkApiName: string): Promise<Record<string, unknown>[]> {
    const fromOt = await getObjectType(orgId, fromType);
    if (!fromOt) throw new Error(`object type not found: ${fromType}`);
    const links = await ctx.db.query<{ to_object_type_id: string; foreign_key_property: string }>(
      `SELECT to_object_type_id, foreign_key_property FROM link_types WHERE org_id = $1 AND from_object_type_id = $2 AND api_name = $3`,
      [orgId, fromOt.id, linkApiName],
    );
    const link = links[0];
    if (!link) throw new Error(`link not found: ${linkApiName}`);
    const toRows = await ctx.db.query<{ api_name: string }>(`SELECT api_name FROM object_types WHERE id = $1`, [link.to_object_type_id]);
    const toApiName = toRows[0]?.api_name;
    if (!toApiName) throw new Error('target object type missing');
    const toOt = await getObjectType(orgId, toApiName);
    if (!toOt) throw new Error('target object type missing');

    const fromObjs = await resolveObjects(orgId, fromType, { filters: [{ property: fromOt.primaryKey, op: '=', value: fromPk }] });
    const fromObj = fromObjs[0];
    if (!fromObj) return [];
    const fkValue = fromObj[link.foreign_key_property];
    if (fkValue === null || fkValue === undefined) return [];

    return resolveObjects(orgId, toApiName, { filters: [{ property: toOt.primaryKey, op: '=', value: fkValue as string | number | boolean }] });
  }
```
Add it to the returned object: `return { createObjectType, listObjectTypes, getObjectType, createLinkType, resolveObjects, createFunction, setPropertySecurity, resolveLinkedObjects };`

- [ ] **Step 2: Add the route — modify `packages/ontology/src/routes.ts`**

Add inside `ontologyRoutes`:
```ts
  fastify.get('/object-types/:apiName/objects/:pk/links/:linkApiName', { preHandler: requirePermission('ontology:read') }, async (req, reply) => {
    const { apiName, pk, linkApiName } = req.params as { apiName: string; pk: string; linkApiName: string };
    try {
      return { objects: await svc.resolveLinkedObjects(req.user!.orgId, apiName, pk, linkApiName) };
    } catch (e) { return reply.code(404).send({ error: (e as Error).message }); }
  });
```

- [ ] **Step 3: Create `packages/ontology/test/links.int.test.ts`**
```ts
import { describe, it, expect, afterAll } from 'vitest';
import { createServer, createConfig, type AppServer } from '@so/server';
import { createLogger } from '@so/observability';
import authModule from '@so/auth';
import datasetsModule from '@so/datasets';
import ontologyModule from '../src/index.js';

const config = createConfig({
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so',
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'localhost:9000', S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin', S3_BUCKET: process.env.S3_BUCKET ?? 'so-datasets',
  ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: 'admin',
});
const FT = 'FlightLink'; const AT = 'AircraftLink';
let server: AppServer;
afterAll(async () => { await server?.stop(); });
function cookieFrom(s: string | string[] | undefined): string { const raw = Array.isArray(s) ? s[0]! : s!; return raw.split(';')[0]!; }

describe('ontology link traversal: Flight -> Aircraft', () => {
  it('resolves the linked object via the foreign-key property', async () => {
    server = await createServer({ modules: [authModule, datasetsModule, ontologyModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();
    const db = server.kernel.ctx.db;
    for (const t of [FT, AT]) {
      await db.query(`DELETE FROM link_types WHERE org_id='org_default' AND (from_object_type_id IN (SELECT id FROM object_types WHERE api_name=$1) OR to_object_type_id IN (SELECT id FROM object_types WHERE api_name=$1))`, [t]);
    }
    for (const t of [FT, AT]) {
      await db.query(`DELETE FROM object_properties WHERE object_type_id IN (SELECT id FROM object_types WHERE org_id='org_default' AND api_name=$1)`, [t]);
      await db.query(`DELETE FROM object_types WHERE org_id='org_default' AND api_name=$1`, [t]);
    }

    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const a = { cookie: cookieFrom(login.headers['set-cookie']) };

    const ad = await server.app.inject({ method: 'POST', url: '/api/datasets?name=aircraftds&format=csv', headers: { ...a, 'content-type': 'text/csv' }, payload: 'tail_no,model\nN1,A320\nN2,B737\n' });
    await server.app.inject({ method: 'POST', url: '/api/ontology/object-types', headers: a, payload: { apiName: AT, datasetId: ad.json().dataset.id, primaryKey: 'tailNumber', properties: [ { apiName: 'tailNumber', column: 'tail_no', type: 'string' }, { apiName: 'model', column: 'model', type: 'string' } ] } });

    const fd = await server.app.inject({ method: 'POST', url: '/api/datasets?name=flightlinkds&format=csv', headers: { ...a, 'content-type': 'text/csv' }, payload: 'flight_no,status,tail_no\nFL-1,Delayed,N1\nFL-2,Boarding,N2\n' });
    await server.app.inject({ method: 'POST', url: '/api/ontology/object-types', headers: a, payload: { apiName: FT, datasetId: fd.json().dataset.id, primaryKey: 'flightNumber', properties: [ { apiName: 'flightNumber', column: 'flight_no', type: 'string' }, { apiName: 'status', column: 'status', type: 'string' }, { apiName: 'tailNo', column: 'tail_no', type: 'string' } ] } });

    const link = await server.app.inject({ method: 'POST', url: '/api/ontology/link-types', headers: a, payload: { apiName: 'aircraft', fromObjectType: FT, toObjectType: AT, foreignKeyProperty: 'tailNo' } });
    expect(link.statusCode).toBe(201);

    const linked = await server.app.inject({ method: 'GET', url: `/api/ontology/object-types/${FT}/objects/FL-1/links/aircraft`, headers: a });
    expect(linked.statusCode).toBe(200);
    const objs = linked.json().objects as Array<{ tailNumber: string; model: string }>;
    expect(objs).toHaveLength(1);
    expect(objs[0]).toMatchObject({ tailNumber: 'N1', model: 'A320' });

    const noauth = await server.app.inject({ method: 'GET', url: `/api/ontology/object-types/${FT}/objects/FL-1/links/aircraft` });
    expect(noauth.statusCode).toBe(401);
  });
});
```

- [ ] **Step 4: Run the FULL ontology suite (regression) with infra up → PASS:** `pnpm run infra:up && pnpm --filter @so/ontology test` (timeout 180000) — existing ontology tests (ontology/functions/rls) + the new links test all pass. Then `pnpm --filter @so/ontology run typecheck` clean. No unused imports.

- [ ] **Step 5: Commit:** `git add -A && git commit -m "feat(ontology): link traversal (resolve linked objects via FK)"`

---

## Task 2: Full verification + merge
- [ ] `pnpm run infra:up && pnpm run infra:seed && pnpm typecheck; pnpm lint; pnpm test` (check exit codes directly) → green; `git checkout main && git merge --ff-only phase21/ontology-link-traversal`

---

## Self-review
- **Spec §6 (Links)** — many-to-one link traversal: resolve the FK value on the FROM object, resolve the TO object set by its primary key. ✓
- **Additive / backward-compatible** — new method + route; no existing behavior changed; existing ontology tests stay green. ✓
- **Deferred:** many-to-many (join dataset), reverse traversal (one-to-many from the TO side), link traversal inside the resolver projection, traversal in the UI. Flagged.
