# Phase 59 — Project Isolation + Auth Hardening Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps `- [ ]`.

**Goal:** Close the pre-publish security gaps from the audit: **C1** project-membership enforcement on scoped modules (cross-project leak), plus cheap auth hardening — **H3** secure cookie, **M1** default-admin warning, **M2** error-message leak, **H4(partial)** computed-function expression denylist, OIDC auto-provision default-off, and an explicit upload body limit.

**Architecture:** A reusable `requireProjectMembership()` preHandler in `@so/auth` (queries `project_members` directly; org-admin `*` bypasses) chained after `requirePermission` on every project-scoped route across the 7 scoped modules. Org-admin-run suites/e2e stay green (they bypass), and the Plan 54 backfill preserves existing members' access.

---

## Pre-flight
- [ ] **Branch:** `git checkout main && git checkout -b phase59/project-isolation`

---

## Task 1: `requireProjectMembership` guard (`@so/auth`)

**Files:** Modify `packages/auth/src/guard.ts` (+ its barrel export in `packages/auth/src/index.ts`)

- [ ] **Step 1** — READ `guard.ts` (it has `requirePermission` using `req.server.ctx.db` + `req.user`). Add:
```ts
import { activeProjectId } from '@so/sdk';
export function requireProjectMembership(): preHandlerHookHandler {
  return async (req, reply) => {
    const user = req.user;
    if (!user) return reply.code(401).send({ error: 'unauthenticated' });
    if (user.permissions.includes('*')) return; // org-admin bypass
    const projectId = activeProjectId(req.headers);
    const rows = await req.server.ctx.db.query(`SELECT 1 AS ok FROM project_members WHERE project_id = $1 AND user_id = $2`, [projectId, user.id]);
    if (!rows[0]) return reply.code(403).send({ error: 'not a member of this project' });
  };
}
```
  Export `requireProjectMembership` from the `@so/auth` barrel (same place `requirePermission` is exported). `pnpm --filter @so/auth typecheck` → 0.

---

## Task 2: Enforce membership on scoped routes (7 modules)

**Files:** Modify routes in `packages/datasets`, `packages/pipelines`, `packages/apps`, `packages/automations`, `packages/connectors-db`, `packages/connectors-cloud`, `packages/connectors-airflow`

- [ ] **Step 1** — In each module's `routes.ts`: import `requireProjectMembership` from `@so/auth` (alongside `requirePermission`). For every route that operates on PROJECT-SCOPED data (i.e. any route whose handler calls `activeProjectId(req.headers)` — list/create/preview/run/runs/schedule/sync/get/update/delete of project resources), change the preHandler from:
  `{ preHandler: requirePermission('<perm>') }` → `{ preHandler: [requirePermission('<perm>'), requireProjectMembership()] }`
  Do NOT add it to org-scoped routes that don't read project data (if any). When unsure, a route that reads/writes a table with a `project_id` column → guard it.
- [ ] **Step 2: typecheck all** `pnpm -r --filter ./packages/* typecheck` (or `pnpm typecheck`) → 0.
- [ ] **Step 3: Commit:** `git add -A && git commit -m "fix(security): enforce project membership on scoped routes (C1)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"`

---

## Task 3: Membership-enforcement integration test (`@so/datasets`)

**Files:** Modify `packages/datasets/test/*.int.test.ts` (READ it; mirror the Plan 54 projects-membership test pattern)

- [ ] **Step 1** — add an `it` proving C1 is closed. Load `@so/admin` + `@so/projects` into the test server (add to the `createServer` modules list + devDeps if missing). Create a non-admin user with a role granting `datasets:read` + `projects:read` (insert the permission keys if absent), create a project the user is NOT a member of (as admin), then:
```ts
    // member-less user cannot read another project's datasets via the X-Project header
    const r = await server.app.inject({ method: 'GET', url: '/api/datasets', headers: { cookie: userCookie, 'x-project': otherProjectId } });
    expect(r.statusCode).toBe(403);
    // admin (wildcard) still can
    const ra = await server.app.inject({ method: 'GET', url: '/api/datasets', headers: { cookie: adminCookie, 'x-project': otherProjectId } });
    expect(ra.statusCode).toBe(200);
```
(Use the file's real harness/cookie helpers. If wiring a second user is too heavy in this file, instead assert: a non-admin user with `datasets:read` but no membership in project `X` gets 403 on `GET /api/datasets` with `x-project: X`, and 200 for a project they ARE added to.)
- [ ] **Step 2: Run → PASS:** `pnpm run infra:up && pnpm --filter @so/datasets test` (timeout 120000).
- [ ] **Step 3: Commit:** `git add -A && git commit -m "test(datasets): prove project-membership enforcement (C1)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"`

---

## Task 4: Auth + server hardening (H3, M1, M2, H4-partial, body limit, OIDC)

**Files:** Modify `packages/auth/src/routes.ts`, `packages/auth/src/migrate.ts`, `packages/auth/src/oidc.ts`, `packages/server/src/server.ts`, `packages/query/src/sql.ts` (+ a query test), `.env.example`

- [ ] **Step 1 — H3 secure cookie:** in `auth/routes.ts`, both `setCookie(SESSION_COOKIE, ...)` calls: add `secure: req.server.ctx.config.get('COOKIE_SECURE') === 'true'` to the cookie options (keep `httpOnly: true, sameSite: 'lax', path: '/'`).
- [ ] **Step 2 — M1 admin warning:** in `auth/migrate.ts` `seed(...)`, when `ADMIN_PASSWORD` is unset or equals `'admin'`, log a prominent warning (use the ctx logger if available there, else `console.warn`): `"[SECURITY] Default admin password in use — set ADMIN_PASSWORD before exposing this deployment."`. Add `ADMIN_PASSWORD=change-me` (with a comment) to `.env.example`.
- [ ] **Step 3 — M2 error leak:** in `server.ts`, set a Fastify error handler that logs the full error server-side but returns a generic body for 5xx: keep `err.statusCode` (4xx validation) messages, but for status ≥ 500 (or no statusCode) respond `{ error: 'internal error' }`. Example:
```ts
  app.setErrorHandler((err, _req, reply) => {
    const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    app.log.error(err);
    reply.code(status).send({ error: status < 500 ? err.message : 'internal error' });
  });
```
  (Adapt to the existing error-handling setup if one is already registered.)
- [ ] **Step 4 — body limit:** where the Fastify instance is created in `server.ts`, pass an explicit `bodyLimit` (e.g. `bodyLimit: 64 * 1024 * 1024`) so uploads have a sane, documented cap.
- [ ] **Step 5 — H4 partial (guardExpression):** in `query/src/sql.ts` `guardExpression`, after the existing char/comment checks, reject dangerous keywords (case-insensitive whole-word-ish): if the lowercased expression matches `/\b(select|attach|copy|pragma|install|load|read_parquet|read_csv|read_json|system|getvariable)\b/` or contains `http`, throw `Error('disallowed expression')`. (Computed functions are arithmetic/comparison over resolved columns — these keywords have no legitimate use there.)
- [ ] **Step 6 — guardExpression test:** add to `packages/query/test/` (new or existing):
```ts
import { describe, it, expect } from 'vitest';
import { buildResolveSql } from '../src/sql.js';
import type { ObjectTypeMapping } from '../src/types.js';
const M = (expr: string): ObjectTypeMapping => ({ objectType: 'T', primaryKey: 'id', properties: [{ name: 'id', column: 'id', type: 'string' }, { name: 'status', column: 'status', type: 'string' }], functions: [{ name: 'f', expression: expr, type: 'bool' }], backing: { kind: 's3', path: 's3://b/x.parquet' } });
describe('guardExpression', () => {
  it('allows a safe comparison', () => { expect(() => buildResolveSql(M("status = 'Delayed'"), 'pg', {})).not.toThrow(); });
  it('rejects a subquery / external read', () => { expect(() => buildResolveSql(M("(SELECT x FROM read_parquet('s3://other/secret.parquet'))"), 'pg', {})).toThrow(); });
});
```
- [ ] **Step 7 — OIDC auto-provision off by default:** in `oidc.ts` `handleCallback`, only create a new user when `config.get('OIDC_AUTO_PROVISION') === 'true'`; otherwise if the email has no existing user, throw `Error('SSO user not provisioned')`. (Existing users still sign in.) Add `OIDC_AUTO_PROVISION=false` to `.env.example` with a comment that SSO is experimental.
- [ ] **Step 8: Run → PASS:** `pnpm --filter @so/query test` + `pnpm --filter @so/auth test` (timeout 120000). typecheck clean.
- [ ] **Step 9: Commit:** `git add -A && git commit -m "fix(security): secure cookie, admin-pw warning, generic 5xx errors, expression denylist, body limit, SSO provisioning off-by-default" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"`

---

## Task 5: Full verification + merge (GATED)
- [ ] Run:
```bash
cd /Users/sumitagrawal/CODE/sumit/SoftwareOntology
pnpm run infra:up && pnpm run infra:seed
pnpm typecheck; tc=$?
pnpm lint; lint=$?
pnpm test >/tmp/p59.log 2>&1; t=$?
grep -E "Tests +[0-9]+ (passed|failed)" /tmp/p59.log | tail -1
echo "tc=$tc lint=$lint t=$t"
if [ $tc -eq 0 ] && [ $lint -eq 0 ] && [ $t -eq 0 ]; then git checkout main && git merge --ff-only phase59/project-isolation && echo MERGED; else echo "NOT MERGING"; fi
```
**Watch:** the new membership guard could break a suite that reads project data as a NON-admin user. All existing module tests + e2e authenticate as the `*` admin (which bypasses), and Plan 54 backfilled existing members, so they should stay green. If a suite 403s, it found a real gap — fix the test/fixture (add the user as a member) rather than weakening the guard. Do NOT merge red. Flaky env: re-run once on mass timeouts / `ERR_IPC_CHANNEL_CLOSED` after `docker info`.

---

## Self-review
- **C1 closed** — non-members (non-admin) can't reach another project's scoped resources via `X-Project`; proven by a datasets integration test. ✓
- **Hardening** — secure-cookie (env), default-admin warning + `.env.example`, generic 5xx, computed-expression denylist (+test), explicit body limit, SSO auto-provision off-by-default. ✓
- **Backward-compatible** — admin `*` bypass + Plan 54 backfill keep all suites/e2e green. ✓
- **Deferred → Plan 60:** H1 (enforce governance markings + property masking inside the resolve service, so Dashboards/AIP can't bypass). Documented in SECURITY.md (Plan 61): H2 OIDC state/nonce (SSO marked experimental), H5 login rate-limiting, M3/M4 connection-string escaping, CORS/helmet posture.
