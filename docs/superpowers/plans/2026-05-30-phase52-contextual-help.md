# Phase 52 — Contextual Help (How-To on Every Page) Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps `- [ ]`.

**Goal:** A **"How to use this" help panel on every surface** — a collapsible, on-brand panel at the top of each page with concrete how-to steps for that surface (all 17 project + console views).

**Architecture:** One pure, jsdom-tested `HelpPanel` (collapsible). A central `help.ts` registry mapping `area:view` → `{title, steps}` (keeps content in one place, no need to touch all 17 view files). `App` renders the panel above the surface inside `.content`. Help styles added to `styles.css`.

---

## Pre-flight
- [ ] **Branch:** `git checkout main && git checkout -b phase52/contextual-help`

---

## Task 1: `HelpPanel` component (+ test)

**Files:** Create `apps/web/src/components/HelpPanel.tsx`, `apps/web/src/components/HelpPanel.test.tsx`

- [ ] **Step 1: `HelpPanel.tsx`**
```tsx
import { useState } from 'react';
export function HelpPanel({ title, steps }: { title: string; steps: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={open ? 'help open' : 'help'}>
      <button className="help-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="help-i">?</span> How to use {title}
        <span className="help-chev">{open ? '▲' : '▼'}</span>
      </button>
      {open ? <ol className="help-steps">{steps.map((s, i) => <li key={i}>{s}</li>)}</ol> : null}
    </div>
  );
}
```

- [ ] **Step 2: `HelpPanel.test.tsx`**
```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { HelpPanel } from './HelpPanel';
describe('HelpPanel', () => {
  it('starts collapsed and expands its steps on click', () => {
    render(<HelpPanel title="Pipelines" steps={['First step here', 'Second step here']} />);
    expect(screen.getByText(/How to use Pipelines/)).toBeInTheDocument();
    expect(screen.queryByText('First step here')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(/How to use Pipelines/));
    expect(screen.getByText('First step here')).toBeInTheDocument();
    expect(screen.getByText('Second step here')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run → PASS:** `pnpm --filter @so/web test` (timeout 120000; the new test passes, nothing regresses).

---

## Task 2: Help content registry

**Files:** Create `apps/web/src/help.ts`

- [ ] **Step 1: `help.ts`** — exact content (keys are `area:view`, matching `App`'s `area` + `view` ids):
```ts
export type HelpEntry = { title: string; steps: string[] };
export const HELP: Record<string, HelpEntry> = {
  // ---- Project context ----
  'project:overview': { title: 'the project overview', steps: [
    'This is your project home. The KPI cards count its datasets, pipelines, and apps.',
    'The activity feed shows recent pipeline runs; recent datasets show what has landed.',
    'On a new project, use the “Get started” cards to upload data, build a pipeline, add a connector, or build an app.',
    'Switch projects from the colored avatars in the far-left rail; the ⌂ icon opens the shared Console.',
  ]},
  'project:data': { title: 'Data', steps: [
    'Lists the datasets in this project. Click one to preview its rows and schema.',
    'To add data, use “Upload & model” for a CSV, or pull from a source under “Connectors”.',
    'Datasets are immutable Parquet; transforming them in Pipelines creates new derived datasets.',
  ]},
  'project:setup': { title: 'Upload & model', steps: [
    'Upload a CSV — it is stored as Parquet and registered as a dataset.',
    'Then model it: set an API name, pick the primary-key column, and map columns to typed properties.',
    'Modeled object types appear org-wide in the Console’s Ontology Explorer and Object Explorer.',
  ]},
  'project:pipelines': { title: 'Pipelines', steps: [
    'Create a pipeline: name it, choose a single SQL transform or a multi-step DAG, and set the output dataset.',
    'Add data-quality expectations (e.g. not-null, row-count) that gate the build.',
    'Run it manually, or set a cron schedule to run it automatically via the worker.',
    'Every run is recorded — open the runs list to see status, row counts, and build health.',
  ]},
  'project:connectors': { title: 'Connectors', steps: [
    'Connect an external source to ingest into a dataset: a Postgres table, an S3 object, a REST endpoint, or Airflow.',
    'Fill the connection form, create the connector, then click Sync to pull data.',
    'Each sync writes or updates a dataset you can preview under Data and model in the ontology.',
  ]},
  'project:apps': { title: 'Apps', steps: [
    'Build a low-code app by composing widgets (tables, metrics) over your object types.',
    'Save the app definition, then Run it to see the live, data-bound result.',
    'Apps are project-scoped; the ontology they read from is shared org-wide.',
  ]},
  'project:automations': { title: 'Automations', steps: [
    'An automation runs a follow-up action when an event fires (for example, after an action executes).',
    'Create one by choosing the trigger event and the action to run.',
    'Use automations to keep derived state in sync without manual steps.',
  ]},
  // ---- Console context ----
  'console:home': { title: 'the Console', steps: [
    'The Console is your shared workspace across all projects.',
    'Click a project card to open it; “New project” starts the creation flow.',
    'The platform tiles and the sidebar reach shared assets: ontology, lineage, catalog, dashboards, governance, API & SDK, and admin.',
  ]},
  'console:ontology': { title: 'the Ontology Explorer', steps: [
    'The ontology is shared across all projects. Pick an object type to manage it.',
    'Add computed functions (SQL expressions), define links to other types, and define actions.',
    'Click “Secure” on a property to require a permission to read it (property-level security).',
    'Use “New object type” to model a type from any project’s dataset.',
  ]},
  'console:explorer': { title: 'the Object Explorer', steps: [
    'Browse the actual objects of a type. Pick a type, then click a row to open its detail.',
    'The detail view resolves linked objects and lets you run actions on the object.',
    'Running an action is an ACID write-back; the new value shows on reload.',
  ]},
  'console:lineage': { title: 'Lineage', steps: [
    'Trace an object type back to its source dataset, the actions that write to it, and its links.',
    'Use this to understand impact before you change a dataset or pipeline.',
  ]},
  'console:catalog': { title: 'the Catalog', steps: [
    'Search across datasets, object types, and other assets from one box.',
    'The audit log records who did what — uploads, action executions, and more.',
    'The global search in the top bar lands you here.',
  ]},
  'console:dashboards': { title: 'Dashboards', steps: [
    'Build a group-by aggregation over an object set (count, sum, average) and view it as a bar chart.',
    'Pick the object type, the property to group by, and the metric.',
  ]},
  'console:governance': { title: 'Governance', steps: [
    'Markings are mandatory access controls. Create a marking (e.g. PII), apply it to a dataset, and grant clearance to roles.',
    'Reading a marked dataset requires clearance for every marking on it — not even an admin bypasses this.',
    'Markings propagate: derived datasets automatically inherit their sources’ markings.',
  ]},
  'console:apisdk': { title: 'API & SDK', steps: [
    'The platform publishes an OpenAPI 3.1 spec covering every endpoint.',
    'Generate a fully-typed client with `pnpm gen:client`, or call the REST API directly.',
    'Use this page to view the spec and copy endpoint details.',
  ]},
  'console:ask': { title: 'Ask', steps: [
    'Ask a natural-language question over your ontology.',
    'The AIP gateway routes to the configured LLM provider and answers grounded in your objects.',
  ]},
  'console:admin': { title: 'Admin', steps: [
    'Manage users, roles, and permissions here.',
    'Create a role with a set of permissions, then create users and assign them roles.',
    'Permissions gate every module — for example datasets:write or ontology:edit.',
  ]},
};
```

---

## Task 3: Wire the panel into `App`

**Files:** Modify `apps/web/src/App.tsx`, `apps/web/src/styles.css`

- [ ] **Step 1: `App.tsx`** — add imports near the other component imports:
```tsx
import { HelpPanel } from './components/HelpPanel';
import { HELP } from './help';
```
- [ ] **Step 2: `App.tsx`** — compute the entry just before the `return` (after `const surface = ...`):
```tsx
  const help = HELP[`${area}:${view}`];
```
- [ ] **Step 3: `App.tsx`** — render it above the surface; change the content div from `<div className="content">{surface}</div>` to:
```tsx
        <div className="content">{help ? <HelpPanel title={help.title} steps={help.steps} /> : null}{surface}</div>
```

- [ ] **Step 4: `styles.css`** — append help styles:
```css
.help{margin-bottom:16px}
.help.open{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 14px;box-shadow:var(--shadow)}
.help-toggle{display:inline-flex;align-items:center;gap:8px;background:var(--accent-soft);color:var(--accent);border:1px solid transparent;border-radius:8px;padding:7px 12px;font-size:13px;font-weight:600;cursor:pointer}
.help-toggle:hover{border-color:var(--accent)}
.help-i{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;background:var(--accent);color:#fff;font-size:11px;font-weight:700;line-height:1}
.help-chev{font-size:9px;opacity:.7}
.help-steps{margin:12px 2px 2px;padding-left:22px;color:var(--ink);max-width:780px}
.help-steps li{margin:6px 0;line-height:1.55;font-size:13.5px}
```

- [ ] **Step 5: Verify:** `pnpm --filter @so/web typecheck` (0); `pnpm --filter @so/web test` (all pass incl. HelpPanel); `pnpm --filter @so/web build`. No unused imports; no `eslint-disable react-hooks/exhaustive-deps`.

- [ ] **Step 6: Commit:** `git add -A && git commit -m "feat(web): contextual how-to help panel on every surface"` (append `-m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"`).

---

## Task 4: Full verification + merge (GATED)
- [ ] Run:
```bash
cd /Users/sumitagrawal/CODE/sumit/SoftwareOntology
pnpm run infra:up && pnpm run infra:seed
pnpm typecheck; tc=$?
pnpm lint; lint=$?
pnpm test >/tmp/p52.log 2>&1; t=$?
grep -E "Tests +[0-9]+ (passed|failed)" /tmp/p52.log | tail -1
echo "tc=$tc lint=$lint t=$t"
if [ $tc -eq 0 ] && [ $lint -eq 0 ] && [ $t -eq 0 ]; then git checkout main && git merge --ff-only phase52/contextual-help && echo MERGED; else echo "NOT MERGING"; fi
```
(Flaky env: re-run on mass ~60000ms timeouts / `ERR_IPC_CHANNEL_CLOSED`; ensure `docker info` works first.)

---

## Self-review
- **Help on every page** — all 17 surfaces (7 project + 10 console) have a registry entry; the panel renders for each. ✓
- **How-to instructions** — each entry is concrete, action-oriented steps specific to that surface. ✓
- **On-brand + unobtrusive** — collapsible accent pill that opens into a card using existing tokens; default collapsed so it never blocks the UI. ✓
- **Testable + DRY** — one pure `HelpPanel` jsdom-tested; content centralized in `help.ts`; one wiring point in `App`. ✓
- **Coverage check:** project ids overview/data/setup/pipelines/connectors/apps/automations ✓; console ids home/ontology/explorer/lineage/catalog/dashboards/governance/apisdk/ask/admin ✓ — matches `PROJECT_ITEMS`/`CONSOLE_ITEMS` in `App.tsx`.
