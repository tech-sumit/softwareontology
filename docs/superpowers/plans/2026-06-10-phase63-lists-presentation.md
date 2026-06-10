# Phase 63 — Lists & Data Presentation Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps `- [ ]`.

**Goal:** Fix audit #4 (no pagination/search + KPI count mismatch), #23 (catalog raw ISO timestamps, internal actor ids, no paging/filter), #24 (duplicate dataset names undisambiguated).

**Architecture:** Datasets list returns `createdAt` (+ keeps order); audit log returns the actor's email and supports `limit`/`offset`; the web app gets a tiny shared `timeAgo` util + client-side search and incremental "Show more" paging on the heavy lists (Data, audit log, object-type lists). Investigate and fix the Overview-KPI vs Data-list count mismatch.

---

## Pre-flight
- [ ] **Branch:** `git checkout main && git checkout -b phase63/lists-presentation`

---

## Task 1: Backend — dataset createdAt + audit actor email/paging

**Files:** Modify `packages/datasets/src/service.ts` (+ routes if needed), `packages/catalog/src/service.ts` + `routes.ts` (+ tests)

- [ ] **datasets** — READ the service. Add `createdAt` to the list/get responses (`created_at` exists on the table). Keep shape additive.
- [ ] **catalog audit** — READ it. (a) JOIN `users` on `audit_log.actor` so each entry carries `actorEmail` when the actor is a user id (fall back to the raw actor string, e.g. `automation`). (b) Support `limit` (default 50, max 200) + `offset` query params on `GET /audit`. Keep response additive (`{ entries, ... }` same key names + new fields).
- [ ] Extend the catalog test minimally: assert an entry has `actorEmail` (or fallback) and that `limit=1` returns one row. Run `pnpm --filter @so/datasets --filter @so/catalog test` → green.
- [ ] **Commit:** `git add -A && git commit -m "feat(api): dataset createdAt + audit actor email and paging" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

## Task 2: KPI count mismatch (#4) — investigate and fix

**Files:** `apps/web/src/views/ProjectOverview.tsx`, possibly `apps/web/src/api.ts` / datasets service

- [ ] READ ProjectOverview: find where the `Datasets` KPI number comes from vs what DataView lists. Determine why the audit saw `1888` on the KPI while the Data list showed ~a dozen rows (suspects: KPI summing row counts instead of counting datasets; or KPI counting org-wide/all-branch rows while the list is project-scoped). Fix so the KPI equals the number of datasets the Data page lists for the active project. Note the root cause in the commit message.

---

## Task 3: Web — timeAgo util + humanized catalog + search/paging on lists

**Files:** Create `apps/web/src/time.ts`; Modify `apps/web/src/views/CatalogView.tsx`, `DataView.tsx`, `OntologyManager.tsx`, `ObjectExplorer.tsx`, `ProjectOverview.tsx` (if it has its own ago logic, centralize), `apps/web/src/api.ts`

- [ ] **`time.ts`** — export `timeAgo(iso: string): string` returning `just now / Nm ago / Nh ago / Nd ago /` else `toLocaleDateString()`. If ProjectOverview already has an equivalent inline helper, move it here and reuse.
- [ ] **api.ts** — widen dataset type with `createdAt?: string`; `catalogAudit` gains optional `limit`/`offset` params and the `actorEmail` field.
- [ ] **CatalogView** — audit table shows `actorEmail` (fallback raw actor) and `timeAgo(createdAt)` with the full ISO in a `title` attr; add a client-side filter input (`aria-label="filter audit"`) over action/objectType/actor; add a **Show more** button that bumps `limit` (or appends the next `offset` page).
- [ ] **DataView** — add columns: CREATED (`timeAgo`) and a muted short-id suffix under the name (`id.slice(0,8)`) to disambiguate duplicates (#24); add a search input (`aria-label="filter datasets"`) filtering by name; render at most 50 rows with a **Show more** button (client-side paging).
- [ ] **OntologyManager + ObjectExplorer** — add a small filter input above the OBJECT TYPES list (`aria-label="filter types"`), client-side `includes()` filtering.
- [ ] Run `pnpm --filter @so/web typecheck && pnpm --filter @so/web test && pnpm --filter @so/web build` → green (extend/keep component tests as needed).
- [ ] **Commit:** `git add -A && git commit -m "feat(web): humanized times, actor emails, search + show-more on heavy lists, dataset disambiguation, KPI fix" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

## Task 4: Full verification + merge (GATED)
- [ ] Run:
```bash
cd /Users/sumitagrawal/CODE/sumit/SoftwareOntology
pnpm run infra:up && pnpm run infra:seed
pnpm typecheck; tc=$?
pnpm lint; lint=$?
pnpm test >/tmp/p63.log 2>&1; t=$?
grep -E "Tests +[0-9]+ (passed|failed)" /tmp/p63.log | tail -1
echo "tc=$tc lint=$lint t=$t"
if [ $tc -eq 0 ] && [ $lint -eq 0 ] && [ $t -eq 0 ]; then git checkout main && git merge --ff-only phase63/lists-presentation && echo MERGED; else echo "NOT MERGING"; fi
```
(Deadlock-flake rule applies; never merge red.)

---

## Self-review
- #4: Data/audit/type lists searchable + incrementally paged; KPI now matches the list (root cause documented). ✓
- #23: relative times w/ full ISO on hover; actor emails; audit limit/offset. ✓
- #24: created column + short-id disambiguates duplicate names. ✓
- All response changes additive; existing tests stay green.
