# Phase 9 — module-admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `@so/admin` — user & role/permission administration, the one real management gap (auth seeds a single admin but offers no way to add users or roles). Plus a small Admin UI tab. Completes the Phase-1 vertical slice. Also fixes the demo bootstrap command (`node`→`tsx`).

**Architecture:** `@so/admin` (dependsOn `auth`) operates on the auth tables via `ctx.db` (transactionally), reusing `@so/auth`'s `hashPassword`, and surfaces all module-contributed permission keys via `ctx.registry.get('permissions')`. Routes are protected with `requirePermission`. A new `apps/web` Admin view lists users and creates them.

> **Note on user creation:** this implements a *product feature* (an org admin manages their own users in their own deployment) — not Claude creating accounts on anyone's behalf. Passwords are hashed with scrypt; no credentials are transmitted anywhere external.

**Tech Stack:** TypeScript, `ctx.db.transaction`, `@so/auth` (hashPassword/requirePermission), React (admin tab); integration-tested via `@so/server` + Postgres.

---

## Pre-flight

- [ ] **Branch:** `cd /Users/sumitagrawal/CODE/sumit/SoftwareOntology && git checkout main && git checkout -b phase9/module-admin`

---

## Task 1: Dev tooling fix (`dev:api` via tsx)

**Files:** Modify root `package.json`; modify `docs/superpowers/plans/2026-05-30-phase8-web-ui.md`

- [ ] **Step 1: Add a `dev:api` script — root `package.json`**

Add to `scripts` (the bootstrap imports TS source, so it must run under `tsx`, not bare `node`):
```json
    "dev:api": "tsx apps/web/dev-server.mjs"
```

- [ ] **Step 2: Fix the Plan 8 doc demo command**

In `docs/superpowers/plans/2026-05-30-phase8-web-ui.md`, replace the demo command `node apps/web/dev-server.mjs` with `pnpm dev:api` (env vars still required, or rely on a local `.env`). One-line doc correction.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "chore(dev): dev:api runs the bootstrap via tsx (TS source imports)"
```

---

## Task 2: `@so/admin` backend (service + routes + module)

**Files:** Create `packages/admin/{package.json,tsconfig.json,vitest.config.ts,src/service.ts,src/routes.ts,src/index.ts,test/admin.int.test.ts}`

- [ ] **Step 1: `packages/admin/package.json`**

```json
{
  "name": "@so/admin",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "dependencies": {
    "@so/sdk": "workspace:*",
    "@so/auth": "workspace:*",
    "fastify": "^5.2.0"
  },
  "devDependencies": {
    "@so/server": "workspace:*",
    "@so/observability": "workspace:*",
    "@types/node": "^22.10.0",
    "@types/pg": "^8.11.0"
  }
}
```

- [ ] **Step 2: `pnpm install`**

- [ ] **Step 3: `packages/admin/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "types": ["node"] },
  "include": ["src/**/*", "test/**/*"]
}
```

- [ ] **Step 4: `packages/admin/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { testTimeout: 60_000, hookTimeout: 60_000 } });
```

- [ ] **Step 5: Create `packages/admin/src/service.ts`**

```ts
import { randomUUID } from 'node:crypto';
import type { ModuleContext } from '@so/sdk';
import { hashPassword } from '@so/auth';

export interface UserSummary { id: string; email: string; roles: string[]; }
export interface RoleSummary { name: string; permissions: string[]; }

export function createAdminService(ctx: ModuleContext) {
  async function listUsers(orgId: string): Promise<UserSummary[]> {
    const users = await ctx.db.query<{ id: string; email: string }>(
      `SELECT id, email FROM users WHERE org_id = $1 ORDER BY email`, [orgId],
    );
    const out: UserSummary[] = [];
    for (const u of users) {
      const roles = await ctx.db.query<{ name: string }>(
        `SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1 ORDER BY r.name`,
        [u.id],
      );
      out.push({ id: u.id, email: u.email, roles: roles.map((r) => r.name) });
    }
    return out;
  }

  async function createUser(orgId: string, input: { email: string; password: string; roleNames?: string[] }): Promise<UserSummary> {
    if (!input.email || !input.password) throw new Error('email and password required');
    const id = randomUUID();
    return ctx.db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO users(id,org_id,email,password_hash) VALUES ($1,$2,$3,$4)`,
        [id, orgId, input.email, hashPassword(input.password)],
      );
      for (const rn of input.roleNames ?? []) {
        const r = await tx.query<{ id: string }>(`SELECT id FROM roles WHERE org_id = $1 AND name = $2`, [orgId, rn]);
        if (!r[0]) throw new Error(`role not found: ${rn}`);
        await tx.query(`INSERT INTO user_roles(user_id,role_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, r[0].id]);
      }
      return { id, email: input.email, roles: input.roleNames ?? [] };
    });
  }

  async function listRoles(orgId: string): Promise<RoleSummary[]> {
    const roles = await ctx.db.query<{ id: string; name: string }>(`SELECT id, name FROM roles WHERE org_id = $1 ORDER BY name`, [orgId]);
    const out: RoleSummary[] = [];
    for (const r of roles) {
      const perms = await ctx.db.query<{ permission_key: string }>(`SELECT permission_key FROM role_permissions WHERE role_id = $1`, [r.id]);
      out.push({ name: r.name, permissions: perms.map((p) => p.permission_key) });
    }
    return out;
  }

  async function createRole(orgId: string, input: { name: string; permissions: string[] }): Promise<void> {
    const id = randomUUID();
    await ctx.db.transaction(async (tx) => {
      await tx.query(`INSERT INTO roles(id,org_id,name) VALUES ($1,$2,$3)`, [id, orgId, input.name]);
      for (const key of input.permissions) {
        await tx.query(`INSERT INTO permissions(key) VALUES ($1) ON CONFLICT DO NOTHING`, [key]);
        await tx.query(`INSERT INTO role_permissions(role_id,permission_key) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, key]);
      }
    });
  }

  /** All permission keys contributed by loaded modules (plus the wildcard). */
  function listPermissions(): string[] {
    const keys = ctx.registry.get<string>('permissions');
    return Array.from(new Set(['*', ...keys])).sort();
  }

  return { listUsers, createUser, listRoles, createRole, listPermissions };
}
```

- [ ] **Step 6: Create `packages/admin/src/routes.ts`**

```ts
import type { FastifyPluginAsync } from 'fastify';
import { requirePermission } from '@so/auth';
import { createAdminService } from './service.js';

export const adminRoutes: FastifyPluginAsync = async (fastify) => {
  const svc = createAdminService(fastify.ctx);

  fastify.get('/users', { preHandler: requirePermission('admin:users') }, async (req) => ({ users: await svc.listUsers(req.user!.orgId) }));

  fastify.post('/users', { preHandler: requirePermission('admin:users') }, async (req, reply) => {
    const body = req.body as { email?: string; password?: string; roleNames?: string[] };
    if (!body?.email || !body?.password) return reply.code(400).send({ error: 'email and password required' });
    try {
      const user = await svc.createUser(req.user!.orgId, { email: body.email, password: body.password, roleNames: body.roleNames });
      return reply.code(201).send({ user });
    } catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  fastify.get('/roles', { preHandler: requirePermission('admin:roles') }, async (req) => ({ roles: await svc.listRoles(req.user!.orgId) }));

  fastify.post('/roles', { preHandler: requirePermission('admin:roles') }, async (req, reply) => {
    const body = req.body as { name?: string; permissions?: string[] };
    if (!body?.name || !Array.isArray(body?.permissions)) return reply.code(400).send({ error: 'name and permissions[] required' });
    try { await svc.createRole(req.user!.orgId, { name: body.name, permissions: body.permissions }); return reply.code(201).send({ ok: true }); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  fastify.get('/permissions', { preHandler: requirePermission('admin:roles') }, async () => ({ permissions: svc.listPermissions() }));
};
```

- [ ] **Step 7: Create `packages/admin/src/index.ts`**

```ts
import { defineModule } from '@so/sdk';
import { adminRoutes } from './routes.js';

export default defineModule({
  id: 'admin',
  dependsOn: ['auth'],
  contributes: {
    apiRoutes: adminRoutes,
    permissions: ['admin:users', 'admin:roles'],
  },
});

export { createAdminService, type UserSummary, type RoleSummary } from './service.js';
```

- [ ] **Step 8: Create `packages/admin/test/admin.int.test.ts`**

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { createServer, createConfig, type AppServer } from '@so/server';
import { createLogger } from '@so/observability';
import authModule from '@so/auth';
import adminModule from '../src/index.js';

const config = createConfig({
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so',
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'localhost:9000',
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin',
  S3_BUCKET: process.env.S3_BUCKET ?? 'so-datasets',
  ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: 'admin',
});

let server: AppServer;
afterAll(async () => { await server?.stop(); });

function cookieFrom(setCookie: string | string[] | undefined): string {
  const raw = Array.isArray(setCookie) ? setCookie[0]! : setCookie!;
  return raw.split(';')[0]!;
}

describe('admin: user & role administration', () => {
  it('creates a role and a user that can then log in', async () => {
    server = await createServer({ modules: [authModule, adminModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();

    // isolation
    const db = server.kernel.ctx.db;
    await db.query(`DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE email='analyst@example.com')`);
    await db.query(`DELETE FROM users WHERE email='analyst@example.com'`);
    await db.query(`DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE name='viewer')`);
    await db.query(`DELETE FROM roles WHERE name='viewer'`);

    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const cookie = cookieFrom(login.headers['set-cookie']);
    const auth = { cookie };

    // permissions list includes module-contributed keys
    const perms = await server.app.inject({ method: 'GET', url: '/api/admin/permissions', headers: auth });
    expect(perms.json().permissions).toContain('admin:users');

    // create a role
    const role = await server.app.inject({ method: 'POST', url: '/api/admin/roles', headers: auth, payload: { name: 'viewer', permissions: ['ontology:read'] } });
    expect(role.statusCode).toBe(201);

    // create a user with that role
    const created = await server.app.inject({ method: 'POST', url: '/api/admin/users', headers: auth, payload: { email: 'analyst@example.com', password: 'pw123', roleNames: ['viewer'] } });
    expect(created.statusCode).toBe(201);

    // it shows up
    const list = await server.app.inject({ method: 'GET', url: '/api/admin/users', headers: auth });
    const analyst = (list.json().users as Array<{ email: string; roles: string[] }>).find((u) => u.email === 'analyst@example.com');
    expect(analyst?.roles).toContain('viewer');

    // the new user can log in (proves createUser produced a valid scrypt hash)
    const newLogin = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'analyst@example.com', password: 'pw123' } });
    expect(newLogin.statusCode).toBe(200);
  });

  it('rejects unauthenticated admin access', async () => {
    const res = await server.app.inject({ method: 'GET', url: '/api/admin/users' });
    expect(res.statusCode).toBe(401);
  });
});
```

- [ ] **Step 9: Run with infra up → PASS**

```bash
pnpm run infra:up
pnpm --filter @so/admin test
```
Expected: 2 tests pass. Then `pnpm --filter @so/admin run typecheck` (clean).

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "feat(admin): @so/admin — user & role/permission administration"
```

---

## Task 3: Admin UI tab in `apps/web`

**Files:** Create `apps/web/src/views/AdminView.tsx`, `apps/web/src/components/UsersTable.tsx`, `apps/web/src/components/UsersTable.test.tsx`; Modify `apps/web/src/api.ts`, `apps/web/src/App.tsx`

- [ ] **Step 1: Extend the API client — modify `apps/web/src/api.ts`**

Add inside the `api` object (after `executeAction`):
```ts
  listUsers: () => req<{ users: Array<{ id: string; email: string; roles: string[] }> }>('GET', '/admin/users'),
  createUser: (email: string, password: string) => req<{ user: unknown }>('POST', '/admin/users', { email, password }),
```

- [ ] **Step 2: Create `apps/web/src/components/UsersTable.tsx`** (pure)

```tsx
export function UsersTable({ users }: { users: Array<{ id: string; email: string; roles: string[] }> }) {
  if (users.length === 0) return <p style={{ color: '#8a929c' }}>No users.</p>;
  return (
    <table>
      <thead><tr><th>Email</th><th>Roles</th></tr></thead>
      <tbody>
        {users.map((u) => (
          <tr key={u.id}><td>{u.email}</td><td>{u.roles.join(', ') || '—'}</td></tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 3: Create `apps/web/src/components/UsersTable.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { UsersTable } from './UsersTable';

describe('UsersTable', () => {
  it('renders users with roles', () => {
    render(<UsersTable users={[{ id: '1', email: 'a@x.com', roles: ['admin'] }]} />);
    expect(screen.getByText('a@x.com')).toBeInTheDocument();
    expect(screen.getByText('admin')).toBeInTheDocument();
  });
  it('shows empty state', () => {
    render(<UsersTable users={[]} />);
    expect(screen.getByText(/no users/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Create `apps/web/src/views/AdminView.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { api } from '../api';
import { UsersTable } from '../components/UsersTable';

export function AdminView() {
  const [users, setUsers] = useState<Array<{ id: string; email: string; roles: string[] }>>([]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');

  async function load() { try { setUsers((await api.listUsers()).users); } catch (e) { setErr((e as Error).message); } }
  useEffect(() => { void load(); }, []);

  async function add() {
    setErr('');
    try { await api.createUser(email, password); setEmail(''); setPassword(''); await load(); }
    catch (e) { setErr((e as Error).message); }
  }

  return (
    <div className="row">
      <div className="main"><UsersTable users={users} /></div>
      <div className="detail">
        <h3 style={{ marginTop: 0 }}>New user</h3>
        <label htmlFor="ne">Email</label>
        <input id="ne" value={email} onChange={(e) => setEmail(e.target.value)} />
        <label htmlFor="np">Password</label>
        <input id="np" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <div style={{ marginTop: 10 }}><button onClick={add}>Create user</button></div>
        {err ? <div className="err">{err}</div> : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Wire the Admin tab — modify `apps/web/src/App.tsx`**

Add the import:
```tsx
import { AdminView } from './views/AdminView';
```
Change the `View` type to include `'admin'`:
```tsx
type View = 'setup' | 'explorer' | 'admin';
```
Add a tab next to the others (after the "Upload & model" tab `div`):
```tsx
        <div className={`tab ${view === 'admin' ? 'active' : ''}`} onClick={() => setView('admin')}>Admin</div>
```
And add to the view switch (in the `.wrap` div), replacing the existing ternary with:
```tsx
        {view === 'setup' ? <SetupView onModeled={() => { setRefreshKey((k) => k + 1); setView('explorer'); }} />
          : view === 'admin' ? <AdminView />
          : <ExplorerView key={refreshKey} />}
```

- [ ] **Step 6: Typecheck + test → PASS**

```bash
pnpm --filter @so/web run typecheck
pnpm --filter @so/web test
```
Expected: typecheck clean; 6 component tests (LoginForm 2 + ObjectsTable 2 + UsersTable 2).

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(web): Admin tab — users table + create-user form"
```

---

## Task 4: Full verification + merge (Phase 1 complete)

- [ ] **Step 1: Full suite**

```bash
pnpm run infra:up && pnpm run infra:seed
pnpm typecheck && pnpm lint && pnpm test
```
Expected: typecheck + lint clean; **53 tests** (prior 49 + admin 2 + web UsersTable 2).

- [ ] **Step 2: Build the UI** — `pnpm --filter @so/web build` (no errors).

- [ ] **Step 3: Merge**

```bash
git checkout main && git merge --ff-only phase9/module-admin
```

---

## Done criteria

- `@so/admin` lists/creates users and roles, assigns roles, and lists all module-contributed permissions (via the kernel registry); a created user can log in.
- The web app has an Admin tab (users table + create-user form).
- `dev:api` runs the demo bootstrap correctly via tsx.
- Full suite green; UI builds. **Phase 1 vertical slice is complete.**

This completes Phase 1. Phase 2 (roadmap): real connectors, pipelines, dataset versioning, derived functions, lineage, property-level RLS, OTel exporters, the `@so/ui-shell` extraction, and Helm/air-gap deployment.

---

## Self-review (against the spec)

- **Spec §6 (module-admin)** — user/permission admin implemented (the genuine gap); ontology/dataset management already exists via earlier modules + the web Setup view, so admin focuses on identity. ✓
- **Spec §8 (NFRs)** — scrypt hashing (reused), transactional writes, parameterized SQL, org-scoped, auth-protected, integration-tested (incl. created-user-can-log-in). ✓
- **Registry use** — `listPermissions` reads `ctx.registry.get('permissions')`, surfacing every module's contributed keys — exercising the kernel's extension registry as designed. ✓
- **Placeholder scan** — complete code throughout. ✓
- **Type consistency** — `UserSummary`/`RoleSummary` defined once; `createAdminService` reused by routes; `api.listUsers`/`createUser` match `AdminView`/`UsersTable`; `req.user!.orgId` (Plan 5), `fastify.ctx` (Plan 3); extensionless web imports (Plan 8 convention). ✓
- **Deliberately deferred:** role editing/deletion, password reset, per-user deactivation, SSO/OIDC user provisioning, a richer ontology-manager UI (basic modeling is in the Setup view) — all Phase 2. Flagged, not silent.
```
