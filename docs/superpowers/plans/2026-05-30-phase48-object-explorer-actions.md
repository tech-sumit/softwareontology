# Phase 48 — Object Explorer + Actions Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps `- [ ]`.

**Goal:** Surface the rest of the ontology runtime: **define actions** (in the Ontology manager) and a new **Explorer** surface to browse a type's objects, open an **object detail** (all properties + **linked objects** via link traversal), and **run actions** (the ACID write-back, then see the value change). All backend exists (`listActions`/`createAction`/`executeAction`/`getObjects`/`resolveLinkedObjects`).

**Architecture:** `api.ts` + `resolveLinkedObjects`; a pure `ObjectDetail` (jsdom-tested); a new `ObjectExplorer` view (Console `explorer` slot); an **Actions** section added to `OntologyManager`.

---

## Pre-flight
- [ ] **Branch:** `git checkout main && git checkout -b phase48/object-explorer-actions`

---

## Task 1: API method + `ObjectDetail` (+ test)

**Files:** Modify `apps/web/src/api.ts`; Create `apps/web/src/components/ObjectDetail.tsx` (+ `.test.tsx`)

- [ ] **Step 1: `api.ts`** — add (note `listActions`/`createAction`/`executeAction`/`getObjects` already exist):
```ts
  resolveLinkedObjects: (objectType: string, pk: string, linkApiName: string) => req<{ objects: Record<string, unknown>[] }>('GET', `/ontology/object-types/${objectType}/objects/${encodeURIComponent(pk)}/links/${linkApiName}`),
```

- [ ] **Step 2: `components/ObjectDetail.tsx`** (pure — properties + action buttons)
```tsx
export function ObjectDetail({ object, actions, onRun }: {
  object: Record<string, unknown>;
  actions: Array<{ apiName: string; kind: string }>;
  onRun: (apiName: string) => void;
}) {
  const keys = Object.keys(object);
  return (
    <div>
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {keys.map((k) => (
          <div key={k} style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
            <div className="k">{k}</div>
            <div className="v">{object[k] === null || object[k] === undefined ? '—' : String(object[k])}</div>
          </div>
        ))}
      </div>
      {actions.length > 0 ? (
        <div style={{ marginTop: 14 }}>
          <h3>Actions</h3>
          <div className="qa">{actions.map((a) => <button key={a.apiName} onClick={() => onRun(a.apiName)}>{a.apiName}</button>)}</div>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: `components/ObjectDetail.test.tsx`**
```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ObjectDetail } from './ObjectDetail';
describe('ObjectDetail', () => {
  it('renders properties + runs an action', () => {
    const onRun = vi.fn();
    render(<ObjectDetail object={{ flightNumber: 'FL-204', status: 'Delayed' }} actions={[{ apiName: 'setStatus', kind: 'modify' }]} onRun={onRun} />);
    expect(screen.getByText('FL-204')).toBeInTheDocument();
    expect(screen.getByText('Delayed')).toBeInTheDocument();
    fireEvent.click(screen.getByText('setStatus'));
    expect(onRun).toHaveBeenCalledWith('setStatus');
  });
});
```

- [ ] **Step 4: Run → PASS:** `pnpm --filter @so/web test -- ObjectDetail` (timeout 120000).

---

## Task 2: `ObjectExplorer` view + nav

**Files:** Create `apps/web/src/views/ObjectExplorer.tsx`; Modify `apps/web/src/App.tsx`

- [ ] **Step 1: `views/ObjectExplorer.tsx`** — a workbench:
  - On mount `api.listObjectTypes()`. A left list of types; selecting one loads `api.getObjectType(name)` (for primaryKey + links + properties) and `api.getObjects(name)` (rows) + `api.listActions()` (filter to this type).
  - Middle: the objects table (reuse `ObjectsTable`: `columns` = property apiNames or row keys, `pk` = the type's primaryKey) — clicking a row selects that object.
  - Right (when an object selected): `<ObjectDetail object={selectedRow} actions={typeActions} onRun={runAction} />`, then **Linked objects** — for each `link` of the type, a section titled `<link.apiName> → <link.toObjectType>` with a small table from `api.resolveLinkedObjects(typeName, pk, link.apiName)` (lazy-load on select).
  - `runAction(apiName)`: prompt for edits as `key=value,key=value` (parse to an object), call `api.executeAction(apiName, { primaryKey: selectedRow[pk], edits })`, then reload `getObjects` + the selected row (so the write-back is visible). Surface errors inline.
  - `card`/`err`/`muted`/`badge` classes; green msg on success.

- [ ] **Step 2: Wire nav — `App.tsx`** — add a Console sidebar item `{ id: 'explorer', label: 'Object Explorer', icon: '◧' }` to `CONSOLE_ITEMS` (after `ontology`); import `ObjectExplorer`; add `case 'explorer': return <ObjectExplorer />;` to the console switch. (Keep `OntologyManager` on `ontology`.)

- [ ] **Step 3: Verify:** `pnpm --filter @so/web typecheck` (0); `pnpm --filter @so/web test` (all pass incl. ObjectDetail); `pnpm --filter @so/web build`. No unused imports; no `eslint-disable react-hooks/exhaustive-deps`.

- [ ] **Step 4: Commit:** `git add -A && git commit -m "feat(web): Object Explorer — browse objects, detail, linked objects, run actions"`

---

## Task 3: Actions section in `OntologyManager` (define actions)

**Files:** Modify `apps/web/src/views/OntologyManager.tsx`

- [ ] **Step 1:** In the selected-type detail, add an **Actions** section: load `api.listActions()` filtered to the current type (`objectType === name`); list them (`apiName · kind`); add a "New action" form (`apiName` input + `kind` select with options `modify` and `create`) → `api.createAction({ apiName, objectType: name, kind })` → reload. (Read the real `ActionKind` values from `packages/actions/src/service.ts`; use those exact strings in the select.)

- [ ] **Step 2: Verify:** typecheck + web test + build all green.

- [ ] **Step 3: Commit:** `git add -A && git commit -m "feat(web): define actions in the Ontology manager"`

---

## Task 4: Full verification + merge (GATED)
- [ ] `pnpm run infra:up && pnpm run infra:seed && pnpm typecheck; pnpm lint`; then `pnpm test >/tmp/v.log 2>&1; t=$?; grep -E "Tests +[0-9]+ (passed|failed)" /tmp/v.log | tail -1`. **Only if tc/lint/`t` all 0**: `git checkout main && git merge --ff-only phase48/object-explorer-actions`. (Flaky env: re-run on mass timeouts / `ERR_IPC_CHANNEL_CLOSED`; ensure Docker up.)

---

## Self-review
- **Object runtime surfaced** — browse a type's objects, open detail (all props), see **linked objects** (traversal), and **run actions** (write-back) with the result visible. ✓
- **Actions defined in the ontology** — list + create action definitions per type. ✓
- **Testable** — pure `ObjectDetail` jsdom-tested; backend already in the green suite. ✓
- **Deferred → Plan 49/50:** action-parameter forms beyond simple `key=value` edits; `create`-kind action UX; richer linked-object drill-down (click a linked object to navigate). Flagged.
