# Phase 60 — Governance Enforcement at the Service Layer Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps `- [ ]`.

**Goal:** Fix audit **H1**: marking-based mandatory access control (clearance) + property-level masking currently live only in route handlers, so `dashboards.aggregate` and the AIP endpoints (`ask`/`index`/`search`/`agent`) read object data **unmasked and unclearance-checked**. Move enforcement into the shared resolve path so every caller inherits it.

**Architecture:** `ontology.resolveObjects` gains an optional `principal: { userId, permissions }`. When present it (1) runs the registered `datasetAccessPolicies` clearance check for the object type's backing dataset and throws a FORBIDDEN error if denied, and (2) masks property values whose `requiredPermission` the principal lacks. The bypassing callers (dashboards, aip) pass the principal; routes translate FORBIDDEN → 403.

---

## Pre-flight
- [ ] **Branch:** `git checkout main && git checkout -b phase60/governance-enforcement`

---

## Task 1: Enforce clearance + masking in `resolveObjects` (`@so/ontology`)

**Files:** Modify `packages/ontology/src/service.ts`, `packages/ontology/src/routes.ts`

- [ ] **Step 1** — READ the **GET objects** route in `ontology/routes.ts` and the **dataset preview** route in `datasets/routes.ts` to capture the EXACT current enforcement: (a) the clearance check (how it gets the registered `datasetAccessPolicies` from the registry and calls `check(ctx, userId, datasetId)`), and (b) the property-masking logic (which masks properties whose `requiredPermission` the user's `permissions` don't include). You will replicate both inside the service.

- [ ] **Step 2** — in `service.ts`, widen `resolveObjects`' options to include `principal?: { userId: string; permissions: string[] }`. After the rows are resolved (and BigInt-coerced), when `options?.principal` is present:
  - **Clearance:** run the same `datasetAccessPolicies` check used by the route, for `ot.datasetId` and `principal.userId`. If denied, `throw Object.assign(new Error('access denied'), { statusCode: 403 })`.
  - **Masking:** for each property `p` in `ot.properties` where `p.requiredPermission` is set and `!principal.permissions.includes(p.requiredPermission)` (and not wildcard `*`), delete/null that key on every returned row.
  Implement this as a small local helper so it's applied consistently. Keep behavior identical to the route for non-bypassing callers.
  - Thread `principal` through `resolveLinkedObjects` too (pass it into the internal `resolveObjects` calls) so linked-object reads are equally enforced.

- [ ] **Step 3** — in `ontology/routes.ts` GET objects: pass `principal: { userId: req.user!.id, permissions: req.user!.permissions }` into the `resolveObjects` options. You MAY keep the route's existing explicit clearance/mask (idempotent) OR remove it now that the service enforces it — either way the route must still return **403** when clearance is denied (wrap in try/catch mapping `err.statusCode === 403` → `reply.code(403)`), and masked values for lacked-permission properties. Preserve existing test behavior.

- [ ] **Step 4: typecheck** `pnpm --filter @so/ontology typecheck` → 0.

---

## Task 2: Pass principal from the bypassing callers

**Files:** Modify `packages/dashboards/src/service.ts` + `routes.ts`, `packages/aip/src/service.ts` + `routes.ts`

- [ ] **Step 1: dashboards** — `aggregate(orgId, objectType, groupBy, principal?)`: forward `principal` into its `ontology.resolveObjects(...)` call. In `dashboards/routes.ts`, pass `{ userId: req.user!.id, permissions: req.user!.permissions }` and wrap the handler so a thrown `statusCode===403` returns `reply.code(403).send({ error: 'access denied' })`.
- [ ] **Step 2: aip** — in `aip/service.ts`, the functions `ask`, `indexObjectType`, `search`, and the agent's tools call `ontology.resolveObjects(...)`. Thread a `principal` parameter from each public method (`ask`, `indexObjectType`, `search`, `agent`) down into those `resolveObjects` calls. In `aip/routes.ts`, pass `{ userId: req.user!.id, permissions: req.user!.permissions }` to each. The existing route try/catch will surface a denied read as an error response (ensure a `statusCode===403` becomes a 403, else 400 is acceptable).
- [ ] **Step 3: typecheck** `pnpm --filter @so/dashboards typecheck && pnpm --filter @so/aip typecheck` → 0.
- [ ] **Step 4: Commit:** `git add -A && git commit -m "fix(security): enforce markings + property masking in resolveObjects so dashboards/AIP can't bypass governance (H1)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"`

---

## Task 3: E2E proves the bypass is closed

**Files:** Modify the e2e suite (it already has a governance/markings step that marks a dataset and asserts an un-cleared principal is denied at the ontology route)

- [ ] **Step 1** — READ the e2e governance section. Identify the object type whose backing dataset is marked, and the principal that lacks clearance (the e2e proves the ontology objects route 403s for it). Add assertions that the SAME un-cleared principal is now ALSO denied via the bypassing surfaces:
```ts
    // dashboards must not bypass the marking
    const agg = await app.inject({ method: 'POST', url: '/api/dashboards/aggregate', headers: unclearedAuth, payload: { objectType: MARKED_OT, groupBy: SOME_PROP } });
    expect(agg.statusCode).toBe(403);
    // AIP search must not bypass it either
    const sr = await app.inject({ method: 'POST', url: '/api/aip/search', headers: unclearedAuth, payload: { objectType: MARKED_OT, query: 'x' } });
    expect([400, 403]).toContain(sr.statusCode);
```
(Substitute the e2e's real app/auth variable names, the marked object type, a group-by property, and the un-cleared principal's headers. If the marked-dataset test reuses the admin principal — markings are mandatory even for `*` — use that same principal that the route already proves is denied.)

- [ ] **Step 2: Run → PASS:** `pnpm --filter @so/e2e test` (timeout 180000). If the e2e's governance step grants clearance later, sequence the new assertions while the principal is still un-cleared.

- [ ] **Step 3: Commit:** `git add -A && git commit -m "test(e2e): dashboards + AIP cannot bypass dataset markings" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"`

---

## Task 4: Full verification + merge (GATED)
- [ ] Run:
```bash
cd /Users/sumitagrawal/CODE/sumit/SoftwareOntology
pnpm run infra:up && pnpm run infra:seed
pnpm typecheck; tc=$?
pnpm lint; lint=$?
pnpm test >/tmp/p60.log 2>&1; t=$?
grep -E "Tests +[0-9]+ (passed|failed)" /tmp/p60.log | tail -1
echo "tc=$tc lint=$lint t=$t"
if [ $tc -eq 0 ] && [ $lint -eq 0 ] && [ $t -eq 0 ]; then git checkout main && git merge --ff-only phase60/governance-enforcement && echo MERGED; else echo "NOT MERGING"; fi
```
**Watch:** adding masking/clearance to `resolveObjects` could change results for callers that previously saw unmasked data. The aip/dashboards tests run as admin (`*`) which passes `requiredPermission` masking (has all perms) and — for markings — is only denied if the dataset is marked AND admin lacks clearance. Existing aip/dashboards tests use UNMARKED datasets, so they should stay green. If one goes red, confirm whether it's a real enforcement change (expected) vs a regression, and fix the test fixture accordingly — do NOT weaken enforcement. Flaky env: the branch-overlay can deadlock under cross-file parallelism — re-run the full suite once before judging; only merge on a fully-green run.

---

## Self-review
- **H1 closed** — clearance + masking enforced inside `resolveObjects`; dashboards + AIP pass a principal and inherit it; proven by e2e. ✓
- **Consistent** — same check/mask logic as the routes, applied at the shared read path; linked-object reads also enforced. ✓
- **Backward-compatible** — admin/`*` with all permissions sees unmasked data on unmarked datasets; existing suites stay green. ✓
- **Remaining (→ SECURITY.md in Plan 61, documented known-limitations):** H2 OIDC state/nonce (SSO marked experimental), H4 full guardExpression AST hardening (denylist landed in P59), H5 login rate-limiting, M3/M4 connection-string escaping, CORS/helmet deployment posture. **This clears the MUST-fix audit list.**
