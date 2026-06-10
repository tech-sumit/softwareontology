# Phase 64 — Saved Dashboards + API Tokens Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps `- [ ]`.

**Goal:** Fix audit #14 (Dashboards are one-off, count-only, unsaveable) and #17 (no programmatic auth, static API page): **sum/avg/count aggregations + saveable dashboards**, and **personal API tokens** (bearer auth) + a useful API & SDK page (descriptions + copy-curl + token management).

---

## Pre-flight
- [ ] **Branch:** `git checkout main && git checkout -b phase64/dashboards-tokens`

---

## Task 1: Dashboards — aggregations + persistence (`@so/dashboards`)

**Files:** Modify `packages/dashboards/src/{service.ts,routes.ts}`; create `migrate.ts` if none exists (wire into `onInstall` like other modules); extend its test

- [ ] READ the module. **Aggregate**: extend `aggregate(orgId, objectType, groupBy, principal?)` with `metric?: { fn: 'count' | 'sum' | 'avg'; property?: string }` — count unchanged (default); sum/avg compute over the numeric `property` per group (in-TS over the resolved objects, like the existing count). Route accepts `{ objectType, groupBy, fn?, property? }` (additive).
- [ ] **Saved dashboards**: table `dashboards(id text PK, org_id text NOT NULL, name text NOT NULL, object_type text NOT NULL, group_by text NOT NULL, fn text NOT NULL DEFAULT 'count', property text, created_by text, created_at timestamptz DEFAULT now(), UNIQUE(org_id, name))`. Service: `saveDashboard(orgId, def, userId)`, `listDashboards(orgId)`, `deleteDashboard(orgId, id)`. Routes: `POST /` , `GET /`, `DELETE /:id` under `dashboards:read` for GET and a write-ish guard — READ the module's registered permissions; if only `dashboards:read` exists, register `dashboards:write` in its module definition and use it for POST/DELETE.
- [ ] Extend the dashboards test: sum/avg over a numeric property; save → list → delete round-trip. `pnpm --filter @so/dashboards test` → green.
- [ ] **Commit:** `git add -A && git commit -m "feat(dashboards): sum/avg aggregations + saveable dashboards" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

## Task 2: API tokens — backend (`@so/auth`)

**Files:** Modify `packages/auth/src/{migrate.ts,service.ts,routes.ts,guard.ts}`; extend the auth test

- [ ] **Table** (append to MIGRATIONS): `api_tokens(id text PK, org_id text NOT NULL, user_id text NOT NULL, name text NOT NULL, token_hash text NOT NULL, created_at timestamptz DEFAULT now(), last_used_at timestamptz)`.
- [ ] **Service**: `createApiToken(orgId, userId, name)` → generate `so_` + 32-byte hex; store **sha256 hash** only; return the plaintext ONCE. `listApiTokens(orgId, userId)` → `[{id,name,createdAt,lastUsedAt}]`. `deleteApiToken(orgId, userId, id)`. `validateApiToken(token)` → look up by hash, return the same `AuthUser` shape `validateSession` returns (reuse its permission query), update `last_used_at` (fire-and-forget).
- [ ] **guard.ts `requirePermission`**: before the cookie check, accept `Authorization: Bearer so_…` → `validateApiToken`; fall through to the cookie path otherwise. (Keep `requireProjectMembership` untouched — it reads `req.user`.)
- [ ] **Routes**: `POST /tokens` (body `{name}`, returns `{id, token}` — plaintext only here), `GET /tokens`, `DELETE /tokens/:id` — all session-authenticated (use an existing logged-in guard pattern, e.g. `requirePermission('auth:read')` if that's the convention — READ how `/me` is guarded and match it; token CRUD must NOT itself be callable with a bearer token? Keep it simple: allow either, like any other route).
- [ ] **Test**: create token → call a protected endpoint (e.g. `GET /api/datasets` in the harness, or `/api/auth/me`) with `Authorization: Bearer <token>` and NO cookie → 200 with the right user; bad token → 401; delete → token stops working. `pnpm --filter @so/auth test` → green.
- [ ] **Commit:** `git add -A && git commit -m "feat(auth): personal API tokens with bearer authentication" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

## Task 3: Web — dashboards UI + API page

**Files:** Modify `apps/web/src/api.ts`, `apps/web/src/views/DashboardsView.tsx`, `apps/web/src/views/ApiSdkView.tsx`, `apps/web/src/help.ts`

- [ ] **api.ts** — `aggregate` gains optional `fn`/`property`; add `saveDashboard`, `listDashboards`, `deleteDashboard`, `createApiToken`, `listApiTokens`, `deleteApiToken`.
- [ ] **DashboardsView** — add a metric select (`count | sum | avg`, `aria-label="metric"`) + numeric-property select shown for sum/avg; a **Save dashboard** button (prompts for a name via a small `.field` input, `aria-label="dashboard name"`); a **Saved dashboards** list (name · type · groupBy · fn) where clicking one loads + runs it, with Delete per row. Keep existing aria-labels.
- [ ] **ApiSdkView** — three upgrades: (1) per-endpoint one-line descriptions (extend the existing endpoint array with a `desc` field — write accurate one-liners); (2) a **copy curl** button per endpoint (`navigator.clipboard.writeText`) producing `curl -H 'Authorization: Bearer <your-token>' http://localhost:3000/api<path>` (POST variants include `-X POST -H 'content-type: application/json' -d '{}'`); (3) an **API tokens** section — create (name → shows the plaintext token ONCE in a copyable `<code>` with a "copy" button and a warning it won't be shown again), list (name/created/lastUsed via `timeAgo`), revoke.
- [ ] **help.ts** — update `console:dashboards` (mention metrics + saving) and `console:apisdk` (mention tokens + curl) steps.
- [ ] `pnpm --filter @so/web typecheck && pnpm --filter @so/web test && pnpm --filter @so/web build` → green.
- [ ] **Commit:** `git add -A && git commit -m "feat(web): saveable dashboards with metrics; API tokens + curl on the API page" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

## Task 4: Full verification + merge (GATED)
- [ ] Run:
```bash
cd /Users/sumitagrawal/CODE/sumit/SoftwareOntology
pnpm run infra:up && pnpm run infra:seed
pnpm typecheck; tc=$?
pnpm lint; lint=$?
pnpm test >/tmp/p64.log 2>&1; t=$?
grep -E "Tests +[0-9]+ (passed|failed)" /tmp/p64.log | tail -1
echo "tc=$tc lint=$lint t=$t"
if [ $tc -eq 0 ] && [ $lint -eq 0 ] && [ $t -eq 0 ]; then git checkout main && git merge --ff-only phase64/dashboards-tokens && echo MERGED; else echo "NOT MERGING"; fi
```
(Deadlock-flake rule applies; never merge red.)

---

## Self-review
- #14: metrics (count/sum/avg) + saved dashboards (save/load/delete), tested. ✓
- #17: bearer-token programmatic auth (hashed at rest, plaintext shown once), token management UI, per-endpoint descriptions + copy-curl. ✓
- Bearer path reuses the exact `AuthUser` shape so every downstream guard (permissions, project membership, governance principal) works unchanged.
