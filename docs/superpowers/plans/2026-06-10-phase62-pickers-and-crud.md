# Phase 62 — Pickers + Management CRUD Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps `- [ ]`.

**Goal:** Fix audit #2 (free-text → pickers), #3 (add-only management → delete/revoke), #18 (governance read-back + revoke), #22 (branches table). Backend DELETE routes + governance read-back, then the UI.

**Architecture:** Small, uniform backend additions per module (`deleteX(orgId, id)` service fn + `DELETE /:id` route guarded by the module's `:write`/manage permission; projects-scoped ones also `requireProjectMembership()`). Governance gains list/revoke for marking↔dataset and marking↔role. UI swaps free-text fields for selects sourced from existing APIs and adds Delete buttons with `window.confirm`.

---

## Pre-flight
- [ ] **Branch:** `git checkout main && git checkout -b phase62/pickers-and-crud`

---

## Task 1: Backend deletes (pipelines, connectors ×3, automations, admin)

**Files:** Modify `service.ts` + `routes.ts` in `packages/pipelines`, `packages/connectors-db`, `packages/connectors-cloud`, `packages/connectors-airflow`, `packages/automations`, `packages/admin`

- [ ] READ each module's service/routes first; follow its existing patterns exactly.
- [ ] **pipelines** — `deletePipeline(orgId, id)`: in a transaction delete the pipeline's schedule row (if a schedules/pipeline_schedules table exists), its runs, its steps/expectations child rows (check the migrate.ts for child tables; delete children first — FK ordering), then the pipeline row. Route: `DELETE /:id` with `requirePermission('pipelines:write')` + `requireProjectMembership()`; 404 if no row deleted.
- [ ] **connectors-db / connectors-cloud / connectors-airflow** — `deleteConnector(orgId, id)` (cloud: covers both s3 and rest rows — check how they're stored). Route: `DELETE /:id` with the module's `connectors:write` + `requireProjectMembership()`; 404 if absent. Do NOT delete the datasets a connector produced.
- [ ] **automations** — `deleteAutomation(orgId, id)`; `DELETE /:id` with `automations:write` + `requireProjectMembership()`.
- [ ] **admin** — `deleteUser(orgId, id)`: refuse deleting YOURSELF (route compares `req.user!.id === id` → 400) ; in a txn delete sessions, user_roles, project_members rows for the user, then the user. `deleteRole(orgId, id)`: refuse if it's the role granting `*` (check role_permissions) → 400 `cannot delete an admin role`; in a txn delete role_permissions + user_roles rows then the role. Routes: `DELETE /users/:id` (`admin:users`), `DELETE /roles/:id` (`admin:roles`).
- [ ] **Tests:** extend ONE existing integration test per area minimally: pipelines (create → delete → list no longer contains), admin (create user → delete → gone; deleting self → 400). Reuse each file's harness.
- [ ] Run the touched suites: `pnpm --filter @so/pipelines --filter @so/connectors-db --filter @so/connectors-cloud --filter @so/connectors-airflow --filter @so/automations --filter @so/admin test` → green. typecheck clean.
- [ ] **Commit:** `git add -A && git commit -m "feat(api): delete endpoints for pipelines, connectors, automations, users, roles" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

## Task 2: Governance read-back + revoke (#18)

**Files:** Modify `packages/governance/src/service.ts`, `packages/governance/src/routes.ts`, its test

- [ ] READ the module. Add service fns (follow existing table/column names from its migrate.ts):
  - `markingDatasets(orgId, markingId)` → `[{ datasetId, name }]` (JOIN datasets for the name)
  - `markingRoles(orgId, markingId)` → `[{ roleId, name }]` (JOIN roles)
  - `removeMarkingFromDataset(orgId, markingId, datasetId)` → boolean
  - `revokeMarkingFromRole(orgId, markingId, roleId)` → boolean
- [ ] Routes (mirror existing style/permissions — reads `governance:read`, mutations `governance:manage`):
  - `GET /markings/:id/datasets`, `GET /markings/:id/roles`
  - `DELETE /markings/:id/datasets/:dsId`, `DELETE /markings/:id/roles/:roleId` (404 when nothing removed)
- [ ] Extend the governance integration test: apply → listed → revoke → no longer listed (both dataset + role paths).
- [ ] `pnpm --filter @so/governance test` → green. **Commit:** `git add -A && git commit -m "feat(governance): read-back + revoke for marking applications and clearances" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

## Task 3: api.ts verbs

**Files:** Modify `apps/web/src/api.ts`

- [ ] Add: `deletePipeline(id)`, `deleteConnectorDb(id)`, `deleteConnectorCloud(id)`, `deleteConnectorAirflow(id)`, `deleteAutomation(id)`, `deleteUser(id)`, `deleteRole(id)`, `markingDatasets(id)`, `markingRoles(id)`, `unmarkDataset(markingId, dsId)`, `revokeMarking(markingId, roleId)` — all thin `req()` wrappers matching the routes above. Match existing naming/response-shape style.

---

## Task 4: UI — pickers (#2)

**Files:** Modify `apps/web/src/views/PipelinesView.tsx`, `AutomationsView.tsx`, `DashboardsView.tsx`

- [ ] **PipelinesView** — replace the free-text `Inputs` field with a multi-select of project datasets (`api.listDatasets()` already loaded or load on mount): `<select multiple aria-label="pipeline inputs" size={4}>` mapping selected option values to the same comma-joined string the create call already sends. Keep the create contract unchanged.
- [ ] **AutomationsView** — replace Trigger/Then free-text with `<select>`s populated from `api.listActions()` (READ api.ts for the exact method/shape). Keep `aria-label`s (`trigger action`, `then action`) and the create payload unchanged.
- [ ] **DashboardsView** — replace group-by free-text with a property `<select>` populated from `api.getObjectType(selectedType)` properties (string-ish first). Re-populate when the type changes. Keep `aria-label="group by"`-style labelling consistent with what exists.

---

## Task 5: UI — deletes, governance read-back, branches table (#3, #18, #22)

**Files:** Modify `apps/web/src/views/PipelinesView.tsx`, `ConnectorsView.tsx`, `AutomationsView.tsx`, `AdminView.tsx`, `GovernanceView.tsx`, `BranchesView.tsx`; `apps/web/src/components/UsersTable.tsx`, `RolesTable.tsx`, `ConnectorList.tsx` (+ their tests)

- [ ] **Delete buttons** — pipelines (in the pipeline list / detail), each connector row (`ConnectorList` gains an optional `onDelete`), automations rows, users rows (`UsersTable` optional `onDelete`, hidden for your own row — pass current email), roles rows (`RolesTable` optional `onDelete`). All: `window.confirm(...)` then call api, then reload; surface errors via the view's existing msg/err pattern. Update the pure components' tests for the new optional props (existing usages without the prop must still render — props optional).
- [ ] **GovernanceView** — when a marking is selected (reuse `mkSel`), show two small read-back tables: "Datasets with this marking" (name + Remove) and "Roles cleared" (name + Revoke), loaded from the new endpoints and reloading after apply/grant/revoke.
- [ ] **BranchesView** — branches table: add CREATED column (humanize: `new Date(createdAt).toLocaleString()`, `—` for main); highlight the ACTIVE branch row (compare to `api.getActiveBranch()` — import it) with the `sel`-style background; `main` status displays `default`; merged branches get a **Delete** button (calls `api.deleteBranch`, confirm first) and open branches keep Review.
- [ ] Run `pnpm --filter @so/web typecheck && pnpm --filter @so/web test && pnpm --filter @so/web build` → green.
- [ ] **Commit:** `git add -A && git commit -m "feat(web): pickers for inputs/actions/group-by, delete management, governance read-back, branches table" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

## Task 6: Full verification + merge (GATED)
- [ ] Run:
```bash
cd /Users/sumitagrawal/CODE/sumit/SoftwareOntology
pnpm run infra:up && pnpm run infra:seed
pnpm typecheck; tc=$?
pnpm lint; lint=$?
pnpm test >/tmp/p62.log 2>&1; t=$?
grep -E "Tests +[0-9]+ (passed|failed)" /tmp/p62.log | tail -1
echo "tc=$tc lint=$lint t=$t"
if [ $tc -eq 0 ] && [ $lint -eq 0 ] && [ $t -eq 0 ]; then git checkout main && git merge --ff-only phase62/pickers-and-crud && echo MERGED; else echo "NOT MERGING"; fi
```
(Deadlock flake rule applies — re-run full suite once; never merge red.)

---

## Self-review
- #2 pipeline inputs / automation actions / dashboard group-by are pickers sourced from real data. ✓
- #3 delete for pipelines, connectors ×3, automations, users (not self), roles (not admin-role) — confirmed + reloading. ✓
- #18 governance read-back tables + revoke both directions, tested. ✓
- #22 branches: created column, active highlight, deletable merged branches, `default` status for main. ✓
- FK-ordering respected in delete transactions (children first — known repo lesson). Scoped routes keep `requireProjectMembership`.
