# Phase 4 — module-auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The first product module: `@so/auth` — org-scoped users, scrypt password hashing, DB-backed sessions, an RBAC schema (roles → permissions), and `login`/`me`/`logout` API routes that plug into the Fastify host from Plan 3.

**Architecture:** `@so/auth` contributes `apiRoutes` (mounted at `/api/auth`) and runs idempotent migrations + an admin seed in `onInstall(ctx)` against `ctx.db`. A pure password module (node:crypto `scrypt`, no native deps) and a DB-backed auth service (`login`/`validateSession`/`logout`/`getUserPermissions`) are unit/integration-tested independently of HTTP. The routes use `@fastify/cookie` (registered inside the auth plugin) for an httpOnly session cookie.

**Tech Stack:** TypeScript, node:crypto (scrypt), `@fastify/cookie`, `pg` (via `ctx.db`), consuming `@so/sdk`; tests integrate through `@so/server`'s `createServer` against Docker Postgres.

**Out of scope (deferred):** cross-module authorization enforcement (a shared `requirePermission` preHandler + root-level cookie) — added when the first *protected* module route exists (datasets/ontology). Property-level row security (Plan 6+). OIDC/SAML providers (later). This plan delivers a working auth round-trip; enforcing it on other modules comes when there are other modules to protect.

---

## Pre-flight

- [ ] **Branch:** `cd /Users/sumitagrawal/CODE/sumit/SoftwareOntology && git checkout main && git checkout -b phase4/module-auth`

---

## File structure

```
packages/auth/
  package.json        @so/auth (dep: @so/sdk, @fastify/cookie; devDep: @so/server @so/observability @types/node @types/pg)
  tsconfig.json
  vitest.config.ts    testTimeout 60s (integration tests hit Postgres)
  src/password.ts     hashPassword / verifyPassword (scrypt, pure)
  src/migrate.ts      runMigrations(db) + seed(db, config)
  src/service.ts      createAuthService(db) + hasPermission()
  src/routes.ts       authRoutes Fastify plugin (login/me/logout)
  src/index.ts        defineModule({ id:'auth', contributes, onInstall })
  test/password.test.ts        (pure unit)
  test/auth.int.test.ts        (migrations + service + routes, vs Postgres)
```

---

## Task 1: `@so/auth` package + password hashing (pure)

**Files:** Create `packages/auth/{package.json,tsconfig.json,vitest.config.ts,src/password.ts,test/password.test.ts}`

- [ ] **Step 1: `packages/auth/package.json`**

```json
{
  "name": "@so/auth",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "dependencies": {
    "@so/sdk": "workspace:*",
    "@fastify/cookie": "^11.0.2"
  },
  "devDependencies": {
    "@so/server": "workspace:*",
    "@so/observability": "workspace:*",
    "@types/node": "^22.10.0",
    "@types/pg": "^8.11.0"
  }
}
```

- [ ] **Step 2: `pnpm install`** — Expected: completes; `@fastify/cookie` present.

- [ ] **Step 3: `packages/auth/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "types": ["node"] },
  "include": ["src/**/*", "test/**/*"]
}
```

- [ ] **Step 4: `packages/auth/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { testTimeout: 60_000, hookTimeout: 60_000 } });
```

- [ ] **Step 5: Write `packages/auth/test/password.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../src/password.js';

describe('password hashing', () => {
  it('verifies a correct password', () => {
    const stored = hashPassword('s3cret');
    expect(verifyPassword('s3cret', stored)).toBe(true);
  });

  it('rejects an incorrect password', () => {
    const stored = hashPassword('s3cret');
    expect(verifyPassword('wrong', stored)).toBe(false);
  });

  it('produces a unique salt per hash', () => {
    expect(hashPassword('same')).not.toBe(hashPassword('same'));
  });

  it('rejects malformed stored values', () => {
    expect(verifyPassword('x', 'not-a-valid-hash')).toBe(false);
  });
});
```

- [ ] **Step 6: Run → FAIL:** `pnpm --filter @so/auth test password` (missing `../src/password.js`)

- [ ] **Step 7: Create `packages/auth/src/password.ts`**

```ts
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

const KEYLEN = 64;

/** Returns "scrypt$<saltHex>$<hashHex>". */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1]!, 'hex');
  const expected = Buffer.from(parts[2]!, 'hex');
  if (expected.length === 0) return false;
  const actual = scryptSync(password, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
```

- [ ] **Step 8: Run → PASS (4 tests)**, then `pnpm --filter @so/auth run typecheck` (clean).

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat(auth): @so/auth package + scrypt password hashing"
```

---

## Task 2: Migrations + admin seed

**Files:** Create `packages/auth/src/migrate.ts`. (Tested via the integration test created in Task 4.)

- [ ] **Step 1: Create `packages/auth/src/migrate.ts`**

```ts
import type { Db, Config } from '@so/sdk';
import { hashPassword } from './password.js';

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS orgs (
     id text PRIMARY KEY,
     name text NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS users (
     id text PRIMARY KEY,
     org_id text NOT NULL REFERENCES orgs(id),
     email text NOT NULL,
     password_hash text NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     UNIQUE (org_id, email)
   )`,
  `CREATE TABLE IF NOT EXISTS roles (
     id text PRIMARY KEY,
     org_id text NOT NULL REFERENCES orgs(id),
     name text NOT NULL,
     UNIQUE (org_id, name)
   )`,
  `CREATE TABLE IF NOT EXISTS permissions (key text PRIMARY KEY)`,
  `CREATE TABLE IF NOT EXISTS role_permissions (
     role_id text NOT NULL REFERENCES roles(id),
     permission_key text NOT NULL REFERENCES permissions(key),
     PRIMARY KEY (role_id, permission_key)
   )`,
  `CREATE TABLE IF NOT EXISTS user_roles (
     user_id text NOT NULL REFERENCES users(id),
     role_id text NOT NULL REFERENCES roles(id),
     PRIMARY KEY (user_id, role_id)
   )`,
  `CREATE TABLE IF NOT EXISTS sessions (
     token text PRIMARY KEY,
     user_id text NOT NULL REFERENCES users(id),
     org_id text NOT NULL,
     expires_at timestamptz NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
];

export async function runMigrations(db: Db): Promise<void> {
  for (const sql of MIGRATIONS) await db.query(sql);
}

/** Idempotently create the default org + admin role (perm '*') + admin user. */
export async function seed(db: Db, config: Config): Promise<void> {
  const email = config.get('ADMIN_EMAIL') ?? 'admin@example.com';
  const password = config.get('ADMIN_PASSWORD') ?? 'admin';
  await db.query(`INSERT INTO orgs(id,name) VALUES ('org_default','Default') ON CONFLICT (id) DO NOTHING`);
  await db.query(`INSERT INTO permissions(key) VALUES ('*') ON CONFLICT DO NOTHING`);
  await db.query(`INSERT INTO roles(id,org_id,name) VALUES ('role_admin','org_default','admin') ON CONFLICT (org_id,name) DO NOTHING`);
  await db.query(`INSERT INTO role_permissions(role_id,permission_key) VALUES ('role_admin','*') ON CONFLICT DO NOTHING`);
  await db.query(
    `INSERT INTO users(id,org_id,email,password_hash) VALUES ('user_admin','org_default',$1,$2) ON CONFLICT (org_id,email) DO NOTHING`,
    [email, hashPassword(password)],
  );
  await db.query(`INSERT INTO user_roles(user_id,role_id) VALUES ('user_admin','role_admin') ON CONFLICT DO NOTHING`);
}
```

- [ ] **Step 2: Typecheck:** `pnpm --filter @so/auth run typecheck` (clean — no behavior to test yet; the integration test in Task 4 exercises this).

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(auth): idempotent migrations + admin seed"
```

---

## Task 3: Auth service (DB-backed)

**Files:** Create `packages/auth/src/service.ts`. (Exercised by Task 4's integration test.)

- [ ] **Step 1: Create `packages/auth/src/service.ts`**

```ts
import { randomBytes } from 'node:crypto';
import type { Db } from '@so/sdk';
import { verifyPassword } from './password.js';

export interface AuthUser {
  id: string;
  orgId: string;
  email: string;
  permissions: string[];
}

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function createAuthService(db: Db) {
  async function getUserPermissions(userId: string): Promise<string[]> {
    const rows = await db.query<{ permission_key: string }>(
      `SELECT DISTINCT rp.permission_key
         FROM user_roles ur
         JOIN role_permissions rp ON rp.role_id = ur.role_id
        WHERE ur.user_id = $1`,
      [userId],
    );
    return rows.map((r) => r.permission_key);
  }

  async function login(email: string, password: string): Promise<string | null> {
    const rows = await db.query<{ id: string; org_id: string; password_hash: string }>(
      `SELECT id, org_id, password_hash FROM users WHERE email = $1`,
      [email],
    );
    const user = rows[0];
    if (!user || !verifyPassword(password, user.password_hash)) return null;
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    await db.query(
      `INSERT INTO sessions(token,user_id,org_id,expires_at) VALUES ($1,$2,$3,$4)`,
      [token, user.id, user.org_id, expiresAt],
    );
    return token;
  }

  async function validateSession(token: string): Promise<AuthUser | null> {
    const rows = await db.query<{ user_id: string; org_id: string; email: string }>(
      `SELECT s.user_id, s.org_id, u.email
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token = $1 AND s.expires_at > now()`,
      [token],
    );
    const r = rows[0];
    if (!r) return null;
    return { id: r.user_id, orgId: r.org_id, email: r.email, permissions: await getUserPermissions(r.user_id) };
  }

  async function logout(token: string): Promise<void> {
    await db.query(`DELETE FROM sessions WHERE token = $1`, [token]);
  }

  return { login, validateSession, logout, getUserPermissions };
}

export function hasPermission(perms: string[], required: string): boolean {
  return perms.includes('*') || perms.includes(required);
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm --filter @so/auth run typecheck
git add -A && git commit -m "feat(auth): DB-backed auth service (login/validateSession/logout/permissions)"
```

---

## Task 4: Routes + module wiring + integration test

**Files:** Create `packages/auth/src/routes.ts`, `packages/auth/src/index.ts`, `packages/auth/test/auth.int.test.ts`

> Needs infra: `pnpm run infra:up`.

- [ ] **Step 1: Create `packages/auth/src/routes.ts`**

```ts
import cookie from '@fastify/cookie';
import type { FastifyPluginAsync } from 'fastify';
import { createAuthService } from './service.js';

export const SESSION_COOKIE = 'so_session';

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(cookie);
  const auth = createAuthService(fastify.ctx.db);

  fastify.post('/login', async (req, reply) => {
    const body = (req.body ?? {}) as { email?: string; password?: string };
    if (!body.email || !body.password) {
      return reply.code(400).send({ error: 'email and password required' });
    }
    const token = await auth.login(body.email, body.password);
    if (!token) return reply.code(401).send({ error: 'invalid credentials' });
    reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/' });
    return { ok: true };
  });

  fastify.get('/me', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) return reply.code(401).send({ error: 'unauthenticated' });
    const user = await auth.validateSession(token);
    if (!user) return reply.code(401).send({ error: 'unauthenticated' });
    return { user };
  });

  fastify.post('/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await auth.logout(token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });
};
```

- [ ] **Step 2: Create `packages/auth/src/index.ts`**

```ts
import { defineModule } from '@so/sdk';
import { runMigrations, seed } from './migrate.js';
import { authRoutes } from './routes.js';

export default defineModule({
  id: 'auth',
  contributes: {
    apiRoutes: authRoutes,
    permissions: ['auth:read'],
  },
  async onInstall(ctx) {
    await runMigrations(ctx.db);
    await seed(ctx.db, ctx.config);
  },
});

export { createAuthService, hasPermission, type AuthUser } from './service.js';
export { hashPassword, verifyPassword } from './password.js';
export { SESSION_COOKIE } from './routes.js';
```

- [ ] **Step 3: Write `packages/auth/test/auth.int.test.ts`**

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { createServer, createConfig, type AppServer } from '@so/server';
import { createLogger } from '@so/observability';
import authModule from '../src/index.js';
import { SESSION_COOKIE } from '../src/routes.js';

const config = createConfig({
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so',
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'localhost:9000',
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin',
  S3_BUCKET: process.env.S3_BUCKET ?? 'so-datasets',
  ADMIN_EMAIL: 'admin@example.com',
  ADMIN_PASSWORD: 'admin',
});

let server: AppServer;
afterAll(async () => { await server?.stop(); });

function cookieFrom(setCookie: string | string[] | undefined): string {
  const raw = Array.isArray(setCookie) ? setCookie[0]! : setCookie!;
  return raw.split(';')[0]!; // "so_session=<token>"
}

describe('auth routes', () => {
  it('logs in, returns the current user, then logs out', async () => {
    server = await createServer({ modules: [authModule], logger: createLogger(), config });
    await server.kernel.start(); // runs migrations + seed
    await server.app.ready();

    const login = await server.app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { email: 'admin@example.com', password: 'admin' },
    });
    expect(login.statusCode).toBe(200);
    const cookie = cookieFrom(login.headers['set-cookie']);
    expect(cookie).toContain(`${SESSION_COOKIE}=`);

    const me = await server.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe('admin@example.com');
    expect(me.json().user.permissions).toContain('*');

    const logout = await server.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
    expect(logout.statusCode).toBe(200);
  });

  it('rejects bad credentials and missing sessions', async () => {
    const bad = await server.app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { email: 'admin@example.com', password: 'nope' },
    });
    expect(bad.statusCode).toBe(401);

    const anon = await server.app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(anon.statusCode).toBe(401);
  });
});
```

- [ ] **Step 4: Run → PASS**

```bash
pnpm run infra:up
pnpm --filter @so/auth test
```
Expected: password (4) + auth.int (2) = 6 tests pass. (Bash timeout 180000.) Then `pnpm --filter @so/auth run typecheck` (clean).

> If `req.body` is `undefined` on the login POST, ensure the inject call sends JSON (Fastify parses `application/json` automatically when `payload` is an object — it does). If `@fastify/cookie` v11's `register`/`setCookie`/`clearCookie` signatures differ, adjust minimally and report.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(auth): login/me/logout routes + module wiring (onInstall migrations/seed)"
```

---

## Task 5: Full verification + merge

- [ ] **Step 1: Full suite**

```bash
pnpm run infra:up && pnpm run infra:seed
pnpm typecheck && pnpm lint && pnpm test
```
Expected: typecheck + lint clean; **37 tests** (prior 31 + auth 6).

- [ ] **Step 2: Merge**

```bash
git checkout main && git merge --ff-only phase4/module-auth
```

---

## Done criteria

- `@so/auth` boots into the host, runs idempotent migrations, seeds a default org + admin user (perm `*`).
- `POST /api/auth/login` issues an httpOnly session cookie; `GET /api/auth/me` returns the user + permissions; `POST /api/auth/logout` revokes it; bad creds / no session → 401.
- Password hashing is scrypt-based (no native dep), unit-tested; the auth service is integration-tested via the real server + Postgres.
- Full suite green (37 tests).

Plan 5 (`module-datasets`) adds CSV/Parquet upload → object storage + a dataset registry, and will be the first module whose routes we protect with auth — at which point we add the shared `requirePermission` preHandler + root cookie (deferred from this plan).

---

## Self-review (against the spec)

- **Spec §6 (module-auth)** — users, sessions, RBAC (roles→permissions), org-scoping (`org_id` on users/roles/sessions), OIDC-ready (pluggable provider deferred; password provider implemented). ✓
- **Spec §8 (NFRs)** — scrypt hashing + timing-safe compare, httpOnly cookies, parameterized SQL, idempotent migrations, integration-tested. ✓
- **Spec §7/§2 (org-scoping)** — `org_id` carried on users/roles/sessions from the first table, matching the multi-tenancy-ready requirement. ✓
- **Placeholder scan** — complete code throughout; the cookie/body notes are version-adaptation guidance, not placeholders. ✓
- **Type consistency** — `AuthUser`, `createAuthService`, `hashPassword`/`verifyPassword`, `authRoutes`, `SESSION_COOKIE` defined once and used consistently across `index.ts`/`routes.ts`/tests; `fastify.ctx` (from Plan 3's augmentation) used in `routes.ts`. ✓
- **Deliberately deferred:** cross-module `requirePermission` enforcement + root cookie (Plan 5, first protected routes); property-level RLS (Plan 6+); OIDC/SAML (later); session sliding-expiry/cleanup job (later). Flagged, not silent.
```
