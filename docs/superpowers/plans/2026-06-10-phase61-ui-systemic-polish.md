# Phase 61 — UI Systemic Polish Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps `- [ ]`.

**Goal:** Fix the systemic UI defects from `docs/UI-AUDIT.md`: broken form layouts (#1), prefilled dev defaults (#5), missing input labels (#6), login page (#8), rail overflow (#9), connectors form placement (#10), apps empty state (#11), console project-card sparseness (#12), clickability cues (#20), hidden empty sections in object detail (#21), and branch-switcher scoping (#25).

**Architecture:** One shared form CSS pattern (`.field` stacked label-over-input + `.frow` for horizontal groups) applied across LoginForm/SetupView/AskView/AdminView; targeted view edits for the rest. UI-only — no backend changes. All existing component tests must stay green (keep every existing `aria-label` value stable).

---

## Pre-flight
- [ ] **Branch:** `git checkout main && git checkout -b phase61/ui-systemic-polish`

---

## Task 1: Shared form CSS + clickability cues

**Files:** Modify `apps/web/src/styles.css`

- [ ] Append:
```css
/* stacked form fields */
.field{display:flex;flex-direction:column;gap:5px;margin:0 0 14px}
.field>label{font-size:12.5px;font-weight:600;color:var(--muted)}
.field>input,.field>textarea,.field>select{width:100%;box-sizing:border-box}
.frow{display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end}
.frow>.field{flex:1;min-width:180px;margin-bottom:0}
.formcard{max-width:560px}
/* clickability cues */
.rowlink{cursor:pointer}
.rowlink:hover{background:var(--accent-soft)}
.listln{cursor:pointer;padding:6px 8px;border-radius:8px}
.listln:hover{background:var(--accent-soft)}
/* rail overflow */
.rail-projects{overflow-y:auto;scrollbar-width:none;min-height:0;flex:1}
.rail-projects::-webkit-scrollbar{display:none}
/* login */
.login-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center}
.login-card{width:380px;max-width:92vw}
.login-brand{display:flex;align-items:center;gap:10px;margin-bottom:18px}
.login-logo{width:34px;height:34px;border-radius:9px;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:17px}
```

---

## Task 2: Forms — stack labels over inputs, drop dev defaults (#1, #5, #6, #8)

**Files:** Modify `apps/web/src/components/LoginForm.tsx` (+ its test if markup-dependent), `apps/web/src/App.tsx` (login wrapper), `apps/web/src/views/SetupView.tsx`, `apps/web/src/views/AskView.tsx`, `apps/web/src/views/AdminView.tsx`

- [ ] **LoginForm** — READ it + its test. Restructure to: a `.login-card .card pad` containing a `.login-brand` header (`<div className="login-logo">S</div><div><strong>SoftwareOntology</strong><div className="muted" style={{fontSize:12}}>Sign in to your workspace</div></div>`), then `.field` blocks (label `Email` + input, label `Password` + input type=password), the primary **Sign in** button full-width, and the SSO button beneath. **Remove the prefilled email/password defaults** (empty initial state; placeholder `you@company.com`). KEEP the existing `aria-label`s and button texts EXACTLY (`Sign in`, `Sign in with SSO`) so tests pass; update the test only if it asserted on default values.
- [ ] **App.tsx login wrapper** — change `<div className="wrap">` around LoginForm to `<div className="login-wrap">`.
- [ ] **SetupView** — READ it. Restructure into `.field`/`.frow` stacks: Dataset name, CSV (textarea, `rows={6}`), Object type name, then the mapping note + submit. **Replace prefilled CSV/value defaults with `placeholder`s** (keep the same sample text as placeholder so the help remains). Keep aria-labels.
- [ ] **AskView** — READ it. Restructure the "Ask (AIP)" card into `.field` stacks (Object type select, Question textarea) with the Ask button below; **drop prefilled question values → placeholders**. Same for the agent input (placeholder only). Keep all aria-labels + button texts.
- [ ] **AdminView** — READ it. Restructure "New user" and "New role" into `.field`/`.frow` (email, password, then a labelled "Roles"/"Permissions" checkbox group in a bordered, max-height scrollable box: `style={{maxHeight:180,overflowY:'auto',border:'1px solid var(--line)',borderRadius:8,padding:8}}`). Add `aria-label`s to the email/password/name inputs if missing (e.g. `aria-label="new user email"`). Keep existing button texts.
- [ ] Run `pnpm --filter @so/web test` → all green (fix any test that asserted prefilled defaults; do not change aria-labels).

---

## Task 3: Rail overflow, connectors form, apps empty state, project cards (#9, #10, #11, #12)

**Files:** Modify `apps/web/src/components/WorkspaceRail.tsx`, `apps/web/src/views/ConnectorsView.tsx`, `apps/web/src/views/AppsView.tsx`, `apps/web/src/views/ConsoleHome.tsx`, `apps/web/src/App.tsx`

- [ ] **WorkspaceRail** — READ it. Wrap the project-avatar list (between the ⌂ Console button and the ＋ New button) in `<div className="rail-projects">…</div>` so many projects scroll instead of colliding with the bottom avatars. Keep test selectors working.
- [ ] **ConnectorsView** — READ it. Move each "create" form OUT of the list flow: render lists first (Database / Cloud / Airflow sections), then a clearly separated `<div className="card pad formcard" style={{marginTop:18}}><h3>New connector</h3>…` containing the three create forms as `.frow`/`.field` groups under subheadings (`Postgres`, `S3 / REST`, `Airflow`). Add `type="password"`-style masking is NOT wanted for connection strings (they're pasted), but add `autoComplete="off"`.
- [ ] **AppsView** — READ it. Improve the empty state: when no apps, render a `.card pad` with an icon, one sentence ("Apps are low-code views composed of widgets bound to your object types."), and a primary **New app** button inline (same handler as the header button).
- [ ] **ConsoleHome** — show each project's `description` under its name when present (`<div className="muted" style={{fontSize:13}}>{p.description}</div>`); widen the projects prop type with `description?: string`. App already passes full project objects.
- [ ] Run `pnpm --filter @so/web test` → green.

---

## Task 4: Clickability cues + object detail empty sections + branch-switcher scoping (#20, #21, #25)

**Files:** Modify `apps/web/src/views/PipelinesView.tsx`, `apps/web/src/views/DataView.tsx`, `apps/web/src/views/ObjectExplorer.tsx`, `apps/web/src/views/OntologyManager.tsx`, `apps/web/src/components/ObjectsTable.tsx` (if it renders the rows), `apps/web/src/components/ObjectDetail.tsx`, `apps/web/src/App.tsx`

- [ ] **Clickable lists** — add `className="listln"` (or `rowlink` on `<tr>`s) to: pipeline list items in PipelinesView, dataset rows in DataView, object-type list items in OntologyManager + ObjectExplorer, and object rows (ObjectsTable rows already select — add `rowlink`). READ each first; apply minimally.
- [ ] **ObjectDetail** — READ it. Always render an **Actions** section and a **Linked objects** section; when empty show `className="muted"` text (`No actions defined for this type.` / `No links defined.`) instead of omitting them.
- [ ] **Branch switcher scoping** — in `App.tsx`, only pass `branches`/`branch`/`onBranchChange` to `<TopBar>` when the surface is branch-sensitive:
```tsx
const branchy = area === 'console' && ['ontology', 'explorer', 'ask', 'branches'].includes(view);
```
Pass the three props only when `branchy` (TopBar already treats them as optional). Keep the TopBar test green.
- [ ] Run `pnpm --filter @so/web typecheck && pnpm --filter @so/web test && pnpm --filter @so/web build` → all green.
- [ ] **Commit:** `git add -A && git commit -m "fix(web): systemic UI polish — stacked forms, no dev defaults, branded login, rail scroll, affordances, switcher scoping" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

## Task 5: Full verification + merge (GATED)
- [ ] Run:
```bash
cd /Users/sumitagrawal/CODE/sumit/SoftwareOntology
pnpm run infra:up && pnpm run infra:seed
pnpm typecheck; tc=$?
pnpm lint; lint=$?
pnpm test >/tmp/p61.log 2>&1; t=$?
grep -E "Tests +[0-9]+ (passed|failed)" /tmp/p61.log | tail -1
echo "tc=$tc lint=$lint t=$t"
if [ $tc -eq 0 ] && [ $lint -eq 0 ] && [ $t -eq 0 ]; then git checkout main && git merge --ff-only phase61/ui-systemic-polish && echo MERGED; else echo "NOT MERGING"; fi
```
(Flaky: branch-overlay deadlocks under cross-file parallelism — a suite failing with `deadlock detected` that passes in isolation is the flake; re-run the full suite once. Never merge red.)

---

## Self-review
- #1 forms stacked via shared `.field`/`.frow`; #5 defaults → placeholders; #6 labels added; #8 centered branded login; #9 rail scrolls; #10 connectors create separated; #11 apps empty state; #12 project-card descriptions; #20 hover/cursor cues; #21 empty sections visible; #25 switcher scoped. UI-only; all aria-labels stable so the 30+ web tests stay green.
