# Phase 65 — Feature-Depth Frontend (Lineage Graph · Upload Mapping · Ask · SQL Editor) Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps `- [ ]`.

**Goal:** Fix audit #13 (lineage is plain text → **visual clickable graph**), #15 (no file upload / opaque mapping → **file picker + editable mapping with PK choice**), #16 (three overlapping ask paradigms → **one agent-first Ask**), #19 (bare SQL textarea → **CodeMirror SQL editor**).

**Architecture:** UI-only (no backend changes). A pure SVG `LineageGraph` component (jsdom-testable); SetupView gains a file input + a client-side header-derived mapping editor feeding the EXISTING `createObjectType` contract; AskView drops the legacy "Ask (AIP)" form (agent + semantic search remain); PipelinesView swaps SQL textareas for `@uiw/react-codemirror` + `@codemirror/lang-sql`.

---

## Pre-flight
- [ ] **Branch:** `git checkout main && git checkout -b phase65/depth-frontend`
- [ ] **Deps:** `pnpm --filter @so/web add @uiw/react-codemirror @codemirror/lang-sql`

---

## Task 1: `LineageGraph` (pure SVG, + test) → LineageView (#13)

**Files:** Create `apps/web/src/components/LineageGraph.tsx` (+ `.test.tsx`); Modify `apps/web/src/views/LineageView.tsx`, `apps/web/src/App.tsx` (navigation callback)

- [ ] **`LineageGraph.tsx`** — props:
```tsx
export type LineageData = { objectType: string; dataset?: { id: string; name: string } | null; actions: string[]; links: Array<{ apiName: string; toObjectType: string }> };
export function LineageGraph({ data, onOpenType }: { data: LineageData; onOpenType?: (apiName: string) => void })
```
Render an SVG (width 100%, viewBox ~`0 0 760 N`): a **dataset** node (left, rounded rect, `var(--accent-soft)` fill + `var(--accent)` stroke, label = dataset name or `—`), an arrow to the **object type** node (center, solid `var(--accent)` fill, white label), arrows out to one node per **action** (top-right, `var(--ok-bg)`) and per **linked type** (bottom-right, `var(--panel)` + border; clickable → `onOpenType(toObjectType)`, `cursor:pointer`, `role="button"`, `aria-label={'open ' + toObjectType}`). Lines via `<line>` with a marker-end arrowhead `<defs><marker>`. Lay out rows vertically (24px gaps); compute height from max(actions, links). Empty arrays → render a muted `<text>` "no actions" / "no links" node instead.
- [ ] **Test:** renders dataset + type labels; clicking a linked-type node fires `onOpenType('Aircraft')`; empty case shows the placeholders. (jsdom: query by text/aria-label.)
- [ ] **LineageView** — READ it + `api.getLineage` shape; map the response into `LineageData` and render `<LineageGraph data={…} onOpenType={(t) => onOpenType?.(t)} />` below the existing select (keep the select + help intact; remove the plain-text BACKING DATASET/ACTIONS/LINKS block). Give LineageView an optional `onOpenType` prop.
- [ ] **App.tsx** — pass `onOpenType` to the lineage case: navigates to the Ontology manager focused on that type — simplest: `openSurface('ontology')` (type-focus deep-link only if OntologyManager already supports an initial-type prop; do NOT build new plumbing).
- [ ] `pnpm --filter @so/web test` → green.

---

## Task 2: Upload — file picker + mapping editor (#15)

**Files:** Modify `apps/web/src/views/SetupView.tsx` (+ a component test if SetupView has one)

- [ ] READ SetupView + the `api` calls it makes (`uploadCsv`, `createObjectType` — the latter takes `{apiName, datasetId, primaryKey, properties:[{apiName, column, type}]}` with PropType `string|int|float|bool|timestamp`).
- [ ] Add a **file input** (`<input type="file" accept=".csv" aria-label="csv file" />`); on change, `await file.text()` into the same CSV state the textarea uses (textarea stays as an alternative; label the two as "Upload a CSV file or paste below").
- [ ] **Mapping editor:** whenever CSV text is present, parse the header row (split first line on commas, trim) and infer a default type per column from the first data row (`int` if `/^-?\d+$/`, `float` if numeric, else `string`). Render a table — one row per column: COLUMN (readonly) · PROPERTY (text input, default camelCased column, `aria-label={'prop for ' + col}`) · TYPE (select of the 5 PropTypes, `aria-label={'type for ' + col}`) · PRIMARY KEY (radio, `name="pk"`, first column default, `aria-label={'pk ' + col}`).
- [ ] Submit uses the edited mapping: `properties = rows.map(r => ({apiName: r.prop, column: r.col, type: r.type}))`, `primaryKey` = the selected row's prop. Remove the old hard-coded auto-mapping note. Keep all existing aria-labels for name fields.
- [ ] `pnpm --filter @so/web test` → green (extend/update SetupView test if one exists).

---

## Task 3: Ask consolidation (#16)

**Files:** Modify `apps/web/src/views/AskView.tsx`, `apps/web/src/help.ts`

- [ ] Remove the legacy "Ask (AIP)" object-type+question form entirely. The surface becomes: title **Ask**, the provider note (keep — it explains echo vs http), the **agent** card FIRST (this is "Ask"), then **Semantic search**. Remove now-unused state/imports.
- [ ] Update `console:ask` help steps to describe the two remaining tools.
- [ ] `pnpm --filter @so/web test` → green.

---

## Task 4: SQL editor (#19)

**Files:** Modify `apps/web/src/views/PipelinesView.tsx`

- [ ] Replace the single-SQL textarea AND the DAG-step SQL textareas with CodeMirror:
```tsx
import CodeMirror from '@uiw/react-codemirror';
import { sql } from '@codemirror/lang-sql';
<CodeMirror value={q} height="140px" extensions={[sql()]} onChange={(v) => setQ(v)} aria-label="pipeline sql" basicSetup={{ lineNumbers: true, foldGutter: false }} />
```
Keep state contracts identical. If the old textarea had an aria-label used by a test, keep a hidden labelled textarea OR update the test to the new structure (prefer updating the test).
- [ ] `pnpm --filter @so/web typecheck && pnpm --filter @so/web test && pnpm --filter @so/web build` → green (note the bundle grows; fine).
- [ ] **Commit (one for Tasks 1–4):** `git add -A && git commit -m "feat(web): visual lineage graph, CSV file upload + mapping editor, agent-first Ask, CodeMirror SQL editor" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

## Task 5: Full verification + merge (GATED)
- [ ] Run:
```bash
cd /Users/sumitagrawal/CODE/sumit/SoftwareOntology
pnpm run infra:up && pnpm run infra:seed
pnpm typecheck; tc=$?
pnpm lint; lint=$?
pnpm test >/tmp/p65.log 2>&1; t=$?
grep -E "Tests +[0-9]+ (passed|failed)" /tmp/p65.log | tail -1
echo "tc=$tc lint=$lint t=$t"
if [ $tc -eq 0 ] && [ $lint -eq 0 ] && [ $t -eq 0 ]; then git checkout main && git merge --ff-only phase65/depth-frontend && echo MERGED; else echo "NOT MERGING"; fi
```
(Deadlock / e2e-poll flake rule: a documented-flake failure that passes in isolation → re-run the FULL suite; only merge fully green.)

---

## Self-review
- #13: clickable SVG lineage graph (tested) replacing the text block. ✓
- #15: real file upload + per-column property/type/PK mapping editor feeding the existing modeling contract. ✓
- #16: one agent-first Ask + semantic search; legacy form removed. ✓
- #19: CodeMirror SQL editing for single-SQL and DAG steps. ✓
- UI-only; backend contracts untouched; e2e unaffected (it talks to the API, not the UI).
