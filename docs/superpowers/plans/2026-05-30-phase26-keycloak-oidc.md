# Phase 26 (#7) — Keycloak / OIDC SSO Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps `- [ ]`.

**Goal:** OIDC/SSO login (Keycloak or any OIDC provider). Standard auth-code flow: redirect to the provider → callback exchanges the code for tokens → fetch userinfo → find-or-create a local user → issue our session cookie. Keycloak owns identity; **our RBAC stays on top** (the local user gets our roles/permissions). Testable against a stub OIDC server (identical contract to Keycloak).

**Architecture:** Additive to merged `@so/auth` — an `oidc.ts` service (`authUrl` + `handleCallback`) + two routes (`/oidc/login`, `/oidc/callback`). Provider endpoints from config (`OIDC_*`). Keycloak added to `docker-compose.yml` behind an optional `keycloak` profile (heavy — opt-in).

---

## Pre-flight
- [ ] **Branch:** `git checkout main && git checkout -b phase26/keycloak-oidc`

---

## Task 1: OIDC in `@so/auth`

**Files:** Create `packages/auth/src/oidc.ts`; Modify `packages/auth/src/routes.ts`, `packages/auth/src/index.ts`; Create `packages/auth/test/oidc.int.test.ts`; Modify `docker-compose.yml`

- [ ] **Step 1: Create `packages/auth/src/oidc.ts`**
```ts
import { randomBytes, randomUUID } from 'node:crypto';
import type { Db, Config } from '@so/sdk';
import { hashPassword } from './password.js';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function createOidcService(db: Db, config: Config) {
  function authUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: config.require('OIDC_CLIENT_ID'),
      redirect_uri: config.require('OIDC_REDIRECT_URI'),
      response_type: 'code', scope: 'openid email', state,
    });
    return `${config.require('OIDC_AUTH_URL')}?${params.toString()}`;
  }

  async function handleCallback(code: string): Promise<string> {
    const tokenRes = await fetch(config.require('OIDC_TOKEN_URL'), {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: config.require('OIDC_REDIRECT_URI'), client_id: config.require('OIDC_CLIENT_ID'), client_secret: config.get('OIDC_CLIENT_SECRET') ?? '' }).toString(),
    });
    if (!tokenRes.ok) throw new Error('oidc token exchange failed');
    const tok = (await tokenRes.json()) as { access_token?: string };
    if (!tok.access_token) throw new Error('no access_token from oidc');

    const uiRes = await fetch(config.require('OIDC_USERINFO_URL'), { headers: { authorization: `Bearer ${tok.access_token}` } });
    if (!uiRes.ok) throw new Error('oidc userinfo failed');
    const ui = (await uiRes.json()) as { sub?: string; email?: string };
    if (!ui.email) throw new Error('no email from oidc');

    const existing = await db.query<{ id: string; org_id: string }>(`SELECT id, org_id FROM users WHERE email = $1`, [ui.email]);
    let userId: string; let orgId = 'org_default';
    if (existing[0]) { userId = existing[0].id; orgId = existing[0].org_id; }
    else { userId = randomUUID(); await db.query(`INSERT INTO users(id,org_id,email,password_hash) VALUES ($1,$2,$3,$4)`, [userId, orgId, ui.email, hashPassword(randomBytes(24).toString('hex'))]); }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    await db.query(`INSERT INTO sessions(token,user_id,org_id,expires_at) VALUES ($1,$2,$3,$4)`, [token, userId, orgId, expiresAt]);
    return token;
  }

  return { authUrl, handleCallback };
}
```

- [ ] **Step 2: Add routes — modify `packages/auth/src/routes.ts`**

Add to the imports:
```ts
import { randomBytes } from 'node:crypto';
import { createOidcService } from './oidc.js';
```
Add inside `authRoutes`:
```ts
  fastify.get('/oidc/login', async (_req, reply) => {
    const oidc = createOidcService(fastify.ctx.db, fastify.ctx.config);
    return reply.redirect(oidc.authUrl(randomBytes(8).toString('hex')));
  });

  fastify.get('/oidc/callback', async (req, reply) => {
    const q = req.query as { code?: string };
    if (!q.code) return reply.code(400).send({ error: 'code required' });
    try {
      const oidc = createOidcService(fastify.ctx.db, fastify.ctx.config);
      const token = await oidc.handleCallback(q.code);
      reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/' });
      return reply.redirect('/');
    } catch (e) { return reply.code(401).send({ error: (e as Error).message }); }
  });
```
(`SESSION_COOKIE` is already defined in routes.ts. If `reply.redirect`'s Fastify-v5 signature differs, adapt minimally — v5 is `reply.redirect(url, code?)`, default 302.)

- [ ] **Step 3: Export — modify `packages/auth/src/index.ts`**

Add: `export { createOidcService } from './oidc.js';`

- [ ] **Step 4: Add Keycloak (optional) — modify `docker-compose.yml`**

Add a service (behind a profile so `up` doesn't start it by default):
```yaml
  keycloak:
    image: quay.io/keycloak/keycloak:26.0
    profiles: ["keycloak"]
    command: start-dev
    environment:
      KC_BOOTSTRAP_ADMIN_USERNAME: admin
      KC_BOOTSTRAP_ADMIN_PASSWORD: admin
    ports: ["8080:8080"]
```

- [ ] **Step 5: Create `packages/auth/test/oidc.int.test.ts`** (stub OIDC server)
```ts
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { createServer as createHttp, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createServer, createConfig, type AppServer } from '@so/server';
import { createLogger } from '@so/observability';
import authModule, { SESSION_COOKIE } from '../src/index.js';

let oidc: Server; let oidcPort = 0;
beforeAll(async () => {
  oidc = createHttp((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url?.startsWith('/token')) { res.end(JSON.stringify({ access_token: 'tok-123', token_type: 'Bearer' })); return; }
    if (req.url?.startsWith('/userinfo')) { res.end(JSON.stringify({ sub: 'kc-1', email: 'oidcuser@example.com' })); return; }
    res.statusCode = 404; res.end('{}');
  });
  await new Promise<void>((r) => oidc.listen(0, r)); oidcPort = (oidc.address() as AddressInfo).port;
});
let server: AppServer;
afterAll(async () => { await server?.stop(); await new Promise<void>((r) => oidc.close(() => r())); });
function cookieFrom(s: string | string[] | undefined): string { const raw = Array.isArray(s) ? s[0]! : s!; return raw.split(';')[0]!; }

describe('OIDC SSO login', () => {
  it('logs in via OIDC callback, creating a local user with our session', async () => {
    const config = createConfig({
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so',
      S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'localhost:9000', S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
      S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin', S3_BUCKET: process.env.S3_BUCKET ?? 'so-datasets',
      ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: 'admin',
      OIDC_AUTH_URL: `http://localhost:${oidcPort}/auth`, OIDC_TOKEN_URL: `http://localhost:${oidcPort}/token`,
      OIDC_USERINFO_URL: `http://localhost:${oidcPort}/userinfo`, OIDC_CLIENT_ID: 'so', OIDC_CLIENT_SECRET: 'secret',
      OIDC_REDIRECT_URI: 'http://localhost:3000/api/auth/oidc/callback',
    });
    server = await createServer({ modules: [authModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();
    const db = server.kernel.ctx.db;
    await db.query(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email='oidcuser@example.com')`);
    await db.query(`DELETE FROM users WHERE email='oidcuser@example.com'`);

    const loginRedirect = await server.app.inject({ method: 'GET', url: '/api/auth/oidc/login' });
    expect(loginRedirect.statusCode).toBe(302);
    expect(loginRedirect.headers.location).toContain(`http://localhost:${oidcPort}/auth`);

    const cb = await server.app.inject({ method: 'GET', url: '/api/auth/oidc/callback?code=abc' });
    expect(cb.statusCode).toBe(302);
    const cookie = cookieFrom(cb.headers['set-cookie']);
    expect(cookie).toContain(`${SESSION_COOKIE}=`);

    const me = await server.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe('oidcuser@example.com');
  });
});
```

- [ ] **Step 6: Run the FULL auth suite (regression) → PASS:** `pnpm run infra:up && pnpm --filter @so/auth test` (timeout 180000) — the existing auth tests (password, auth.int) PLUS the new oidc test pass. typecheck clean; no unused imports.

- [ ] **Step 7: Commit:** `git add -A && git commit -m "feat(auth): OIDC/SSO login (Keycloak-compatible) with local RBAC on top"`

---

## Task 2: Full verification + merge
- [ ] `pnpm run infra:up && pnpm run infra:seed && pnpm typecheck; pnpm lint; pnpm test` (exit codes) → green; `git checkout main && git merge --ff-only phase26/keycloak-oidc`

---

## Self-review
- **User #7 (Keycloak + RBAC on top)** — standard OIDC auth-code flow (works against Keycloak), find-or-create local user, our session + RBAC unchanged on top. Keycloak in compose behind an optional profile. ✓
- **Additive / backward-compatible** — new oidc service + routes; password login untouched; existing auth tests stay green. ✓
- **Testable** — stub OIDC server with the exact `/token` + `/userinfo` contract Keycloak exposes. ✓
- **Deferred:** ID-token JWT signature verification (uses userinfo as source of truth — fine for confidential clients; add JWKS verification for public clients), state/PKCE/nonce checks, group→role mapping from Keycloak claims, logout federation, realm/client provisioning automation. Flagged.
