# Phase 40 — Project-Scope Connectors (db / cloud / airflow) Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps `- [ ]`.

**Goal:** Apply the established project-scoping pattern (Plans 38–39) to the three connector modules: `@so/connectors-db`, `@so/connectors-cloud`, `@so/connectors-airflow`. Each gets a `project_id` column (default `project_default`); `create` stamps the active project, `list` filters by it (`activeProjectId(req.headers)` from `@so/sdk`). `sync` (by id) stays as-is.

**Architecture:** Three near-identical mechanical changes, same as datasets/apps/automations. Backward-compatible (column default + no-header ⇒ Default). **Deferred:** stamping the sync-output dataset with the connector's project (outputs default to `project_default`) — a later refinement.

---

## Pre-flight
- [ ] **Branch:** `git checkout main && git checkout -b phase40/scope-connectors`

---

## Per-module pattern (apply to ALL THREE: connectors-db, connectors-cloud, connectors-airflow)

For each module `packages/<mod>/`, READ `migrate.ts`, `service.ts`, `routes.ts` first to get exact table name, INSERT column count, and create-field names, then:

1. **`migrate.ts`** — append to the `MIGRATIONS` array:
   `ALTER TABLE <table> ADD COLUMN IF NOT EXISTS project_id text NOT NULL DEFAULT 'project_default'`
   (Table names: connectors-db → `db_connectors`; connectors-cloud → confirm via its migrate.ts (likely `cloud_connectors`); connectors-airflow → `airflow_connectors`.)

2. **`service.ts`** — change ONLY the create + list functions:
   - The create function: add a `projectId: string` parameter (place it right after `orgId`); add `project_id` to its INSERT column list + a `$N` placeholder bound to `projectId`.
   - The list function: add a `projectId: string` parameter; add `AND project_id = $2` to its SELECT and pass `[orgId, projectId]`.
   - Leave `sync` and everything else byte-for-byte.

3. **`routes.ts`** — add a VALUE import `import { activeProjectId } from '@so/sdk';`; in the create route pass `activeProjectId(req.headers)` as the 2nd arg to the create call; in the list route pass it to the list call. Leave the `/:id/sync` route unchanged.

4. **Test** — create `packages/<mod>/test/<mod>-projects.int.test.ts`:
   - Boot `[authModule, <mod>Module]` (add `datasetsModule` too **only if** the module's `dependsOn` requires it — check `index.ts` `dependsOn` and `package.json`; e.g. these connectors `dependsOn: ['datasets','auth']`, so include `datasetsModule`).
   - Login admin (`cookieFrom`); clean up the two test connector names at the start.
   - POST a **minimal valid** connector (read the module's create route for required fields) with header `x-project: projA` (name `<mod>A`) and another with `x-project: projB` (name `<mod>B`).
   - GET the list with `x-project: projA`; assert it contains `<mod>A` and NOT `<mod>B`.
   - Use the standard config/`cookieFrom`/`afterAll` boilerplate from the Plan 39 tests.

5. **Run → PASS:** `pnpm run infra:up && pnpm --filter @so/<mod> test` (timeout 180000). Full module suite (existing + new scoping test) green; typecheck clean. Run twice to confirm idempotency.

6. **Commit:** `git add -A && git commit -m "feat(<mod>): project-scope create+list (X-Project)"` (with the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer).

---

## Task order
- [ ] **Task 1:** `connectors-db` (table `db_connectors`).
- [ ] **Task 2:** `connectors-cloud` (confirm table name).
- [ ] **Task 3:** `connectors-airflow` (table `airflow_connectors`; create needs `provider`, `conn`, `query` — its sync calls a runner, but create itself just stores the spec, so the scoping test does NOT need the runner).

---

## Task 4: Full verification + merge (GATED)
- [ ] `pnpm run infra:up && pnpm run infra:seed && pnpm typecheck; pnpm lint`; then `pnpm test >/tmp/v.log 2>&1; t=$?; grep -E "Tests +[0-9]+ (passed|failed)" /tmp/v.log | tail -1`. **Only if typecheck, lint, and `t` all 0**: `git checkout main && git merge --ff-only phase40/scope-connectors`. (If many ~60000ms timeouts appear at once, Docker died mid-run — restart it (`open -a Docker`, wait, `infra:up`) and re-run; do not edit code.)

---

## Self-review
- **Pattern applied** — all three connectors project-scope `create`+`list`. Completes backend project-scoping (datasets, pipelines, apps, automations, connectors). ✓
- **Backward-compatible** — column defaults; no-header ⇒ Default; existing connector tests stay green. ✓
- **Contained** — only create/list signatures change (called only by each module's routes); `sync` untouched. ✓
- **Deferred:** sync-output dataset project-stamping; get/delete-by-id project enforcement. Flagged.
