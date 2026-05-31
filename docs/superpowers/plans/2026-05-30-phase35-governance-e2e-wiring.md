# Phase 35 — Governance End-to-End: Wiring + E2E Journey Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps `- [ ]`.

**Goal:** Make governance run in the actual app and prove it end-to-end. Register `@so/governance` in the production module list (`apps/web/modules.mjs` → container server/worker + the e2e DB warm-up) and the dev server (`dev-server.mjs`), and extend the full-platform **E2E journey** with a governance segment: mark a dataset → mandatory-access deny → grant → allow → pipeline → propagation.

**Architecture:** Pure wiring + test. No new module code. Adding governance to `modules.mjs` means the container's `server.mjs`/`worker.mjs` and the e2e `vitest.global-setup.ts` (which imports `modules.mjs`) all pick it up automatically.

---

## Pre-flight
- [ ] **Branch:** `git checkout main && git checkout -b phase35/governance-e2e-wiring`

---

## Task 1: Register governance in the running app

**Files:** Modify `apps/web/package.json`, `apps/web/modules.mjs`, `apps/web/dev-server.mjs`

- [ ] **Step 1: dependency — modify `apps/web/package.json`**

Add to `devDependencies` (next to the other `@so/*` entries): `"@so/governance": "workspace:*",`. Then run `pnpm install`.

- [ ] **Step 2: production module list — modify `apps/web/modules.mjs`**

Add the import (with the others): `import governance from '@so/governance';`
Add `governance` to the exported `modules` array (e.g. after `apps`, before `openapi` — order is not significant, the kernel sorts by `dependsOn`).

- [ ] **Step 3: dev server — modify `apps/web/dev-server.mjs`**

Add the import: `import governance from '@so/governance';`
Add `governance` to the `modules: [...]` array.

---

## Task 2: Governance in the E2E journey

**Files:** Modify `packages/e2e/package.json`, `packages/e2e/test/journey.e2e.test.ts`

- [ ] **Step 1: dependency — modify `packages/e2e/package.json`**

Add to the deps (where the other `@so/*` are): `"@so/governance": "workspace:*",`. Then run `pnpm install`.

- [ ] **Step 2: import + module list — modify `packages/e2e/test/journey.e2e.test.ts`**

Add the import (after the `automations` import): `import governance from '@so/governance';`
Add `governance` to the `modules: [...]` array in `beforeAll` (after `automations`).

- [ ] **Step 3: cleanup — modify the `beforeAll` isolation block**

Just before `admCookie = await login('admin@example.com', 'admin');`, add:
```ts
  await db.query(`DELETE FROM role_markings WHERE marking_id IN (SELECT id FROM markings WHERE name='E2EMARK')`);
  await db.query(`DELETE FROM dataset_markings WHERE marking_id IN (SELECT id FROM markings WHERE name='E2EMARK')`);
  await db.query(`DELETE FROM markings WHERE name='E2EMARK'`);
  await db.query(`DELETE FROM pipelines WHERE name='e2egovpipe'`);
```

- [ ] **Step 4: governance journey segment — modify the journey `it`**

At the END of the `it(...)` body (after the last existing step, before the closing `});`), add:
```ts
    // N. governance: markings → mandatory access control → propagation
    const govUp = await server.app.inject({ method: 'POST', url: '/api/datasets?name=e2egov&format=csv', headers: { ...a, 'content-type': 'text/csv' }, payload: 'k,v\n1,a\n2,b\n' });
    const govDid = govUp.json().dataset.id as string;
    const mk = await server.app.inject({ method: 'POST', url: '/api/governance/markings', headers: a, payload: { name: 'E2EMARK' } });
    const mid = mk.json().id as string;
    await server.app.inject({ method: 'POST', url: `/api/governance/markings/${mid}/datasets/${govDid}`, headers: a });
    // mandatory access: even the admin is denied until cleared
    expect((await server.app.inject({ method: 'GET', url: `/api/datasets/${govDid}/preview`, headers: a })).statusCode).toBe(403);
    await server.app.inject({ method: 'POST', url: `/api/governance/markings/${mid}/roles/role_admin`, headers: a });
    expect((await server.app.inject({ method: 'GET', url: `/api/datasets/${govDid}/preview`, headers: a })).statusCode).toBe(200);
    // propagation: a derived dataset inherits the source marking
    const gp = await server.app.inject({ method: 'POST', url: '/api/pipelines', headers: a, payload: { name: 'e2egovpipe', inputs: ['e2egov'], sql: 'SELECT * FROM e2egov' } });
    const gr = await server.app.inject({ method: 'POST', url: `/api/pipelines/${gp.json().id}/run`, headers: a });
    const om = await server.app.inject({ method: 'GET', url: `/api/governance/datasets/${gr.json().datasetId}/markings`, headers: a });
    expect((om.json().markings as Array<{ name: string }>).some((m) => m.name === 'E2EMARK')).toBe(true);
```

- [ ] **Step 5: (optional polish) update the journey title** — change the `describe`/`it` text from "all 12 modules" to "all 13 modules" and append "→ governance" to the `it` title string. (Cosmetic; skip if it complicates the diff.)

- [ ] **Step 6: Run → PASS:** `pnpm run infra:up && pnpm --filter @so/e2e test` (timeout 180000) — the journey (now incl. governance) passes; idempotent (run twice). typecheck clean; no unused imports.

- [ ] **Step 7: Commit:** `git add -A && git commit -m "feat(e2e): wire governance into the app + full-journey coverage (markings/MAC/propagation)"`

---

## Task 3: Full verification + merge
- [ ] `pnpm run infra:up && pnpm run infra:seed && pnpm typecheck; pnpm lint` (exit codes). Then **gate the test**: `pnpm test >/tmp/v.log 2>&1; t=$?; grep -E "Tests +[0-9]+ (passed|failed)" /tmp/v.log | tail -1`. **Only if `t -eq 0`** (and tc/lint 0): `git checkout main && git merge --ff-only phase35/governance-e2e-wiring`. (Governance now boots in the full suite via `modules.mjs` warm-up + the e2e module list — confirm the whole suite stays green.)

---

## Self-review
- **End-to-end (backend)** — governance runs in the live app (dev + container) and is proven in the full-platform journey: mark → deny (even admin) → grant → allow → pipeline → propagation, composed with all other modules. ✓
- **One wiring point** — `modules.mjs` feeds the container server/worker AND the e2e warm-up; `dev-server.mjs` feeds `pnpm dev:api`. ✓
- **Idempotent** — the segment cleans its `E2EMARK` marking + `e2egov`/`e2egovpipe` fixtures in `beforeAll`; uses a unique marking name so it can't race the governance unit tests. ✓
- **Merge gated on green** — Task 3 checks the test exit code before merging (do not merge red). ✓
- **Next:** the Governance UI (a markings/clearance tab) — Plan 36 — then live browser verification.
