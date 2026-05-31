# Phase 43 — Connectors + Automations Surface UIs Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps `- [ ]`.

**Goal:** Fill two placeholder surfaces with real UIs wiring existing (tested) backends:
- **Connectors** — list + create + sync for the three connector kinds: DB (Postgres), Cloud (S3/REST), Airflow.
- **Automations** — list + create (trigger action → then action).

**Architecture:** A pure `ConnectorList` component (jsdom-tested) + stateful `ConnectorsView` and `AutomationsView`. New `api.ts` methods. `App.tsx` swaps both placeholders. Both are project-scoped (the shell already sends `X-Project`).

> The subagent MUST read each connector/automation route (`packages/connectors-db|cloud|airflow/src/routes.ts`, `packages/automations/src/routes.ts`) to get the exact create-field names and list-response shape, then build minimal valid forms accordingly.

---

## Pre-flight
- [ ] **Branch:** `git checkout main && git checkout -b phase43/connectors-automations-ui`

---

## Task 1: API methods

**Files:** Modify `apps/web/src/api.ts` — add inside the `api` object (read the routes first; adjust paths/field names to match exactly):
```ts
  // connectors (read each routes.ts for the list-response key + create body fields)
  listConnectorsDb: () => req<{ connectors: Array<{ id: string; name: string }> }>('GET', '/connectors-db'),
  createConnectorDb: (body: unknown) => req<{ id: string }>('POST', '/connectors-db', body),
  syncConnectorDb: (id: string) => req<{ datasetId?: string; rowCount?: number }>('POST', `/connectors-db/${id}/sync`),
  listConnectorsCloud: () => req<{ connectors: Array<{ id: string; name: string }> }>('GET', '/connectors-cloud'),
  createConnectorS3: (body: unknown) => req<{ id: string }>('POST', '/connectors-cloud/s3', body),
  createConnectorRest: (body: unknown) => req<{ id: string }>('POST', '/connectors-cloud/rest', body),
  syncConnectorCloud: (id: string) => req<{ datasetId?: string; rowCount?: number }>('POST', `/connectors-cloud/${id}/sync`),
  listConnectorsAirflow: () => req<{ connectors: Array<{ id: string; name: string }> }>('GET', '/connectors-airflow'),
  createConnectorAirflow: (body: unknown) => req<{ id: string }>('POST', '/connectors-airflow', body),
  syncConnectorAirflow: (id: string) => req<{ datasetId?: string; rowCount?: number }>('POST', `/connectors-airflow/${id}/sync`),
  // automations
  listAutomations: () => req<{ automations: Array<{ id: string; name: string; triggerAction: string; thenAction: string }> }>('GET', '/automations'),
  createAutomation: (body: unknown) => req<{ id: string }>('POST', '/automations', body),
```
(If a list route returns a different shape/key, fix the type. Verify each `sync` response shape.)

---

## Task 2: `ConnectorList` pure component (+ test)

**Files:** Create `apps/web/src/components/ConnectorList.tsx`, `apps/web/src/components/ConnectorList.test.tsx`

- [ ] **Step 1: `ConnectorList.tsx`**
```tsx
export function ConnectorList({ connectors, onSync }: { connectors: Array<{ id: string; name: string }>; onSync: (id: string) => void }) {
  if (connectors.length === 0) return <p style={{ color: '#8a929c' }}>None yet.</p>;
  return (
    <table>
      <thead><tr><th>Name</th><th></th></tr></thead>
      <tbody>
        {connectors.map((c) => (
          <tr key={c.id}><td>{c.name}</td><td><button className="sec" onClick={() => onSync(c.id)}>Sync</button></td></tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 2: `ConnectorList.test.tsx`**
```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ConnectorList } from './ConnectorList';

describe('ConnectorList', () => {
  it('lists connectors and syncs on click', () => {
    const onSync = vi.fn();
    render(<ConnectorList connectors={[{ id: 'c1', name: 'sales-db' }]} onSync={onSync} />);
    expect(screen.getByText('sales-db')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Sync'));
    expect(onSync).toHaveBeenCalledWith('c1');
  });
  it('empty state', () => {
    render(<ConnectorList connectors={[]} onSync={() => {}} />);
    expect(screen.getByText(/none yet/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run → PASS:** `pnpm --filter @so/web test -- ConnectorList` (timeout 120000).

---

## Task 3: Views + nav wiring

**Files:** Create `apps/web/src/views/ConnectorsView.tsx`, `apps/web/src/views/AutomationsView.tsx`; Modify `apps/web/src/App.tsx`

- [ ] **Step 1: `ConnectorsView.tsx`** — three sections (DB, Cloud S3, Airflow), each: a minimal create form (fields per the routes you read; e.g. DB: name + conn string + table/query; S3: name + s3Url; Airflow: name + provider + conn + query), a `ConnectorList` of that type, and Sync buttons (on sync, show a small result/error message). Use the standard `card`/`err` classes + a green `msg` line. Keep forms minimal-but-valid; load all three lists on mount; refresh the relevant list after create/sync. Surface sync errors (e.g. Airflow runner not running) inline rather than throwing.

- [ ] **Step 2: `AutomationsView.tsx`** — list automations (name, triggerAction → thenAction) + a create form (name, trigger action api-name, then action api-name, then-edits as a simple `key=value` or JSON optional). On create, refresh. `card`/`err` classes.

- [ ] **Step 3: Wire nav — `App.tsx`** — import both views; change `case 'connectors':` → `<ConnectorsView key={refreshKey} />` and `case 'automations':` → `<AutomationsView key={refreshKey} />` (remove those two `PlaceholderView` usages).

- [ ] **Step 4: Verify the web package:** `pnpm --filter @so/web typecheck` (0); `pnpm --filter @so/web test` (all pass incl. ConnectorList); `pnpm --filter @so/web build` (succeeds). (timeout 180000). No unused imports; no `eslint-disable react-hooks/exhaustive-deps`.

- [ ] **Step 5: Commit:** `git add -A && git commit -m "feat(web): Connectors + Automations surfaces (list/create/sync)"`

---

## Task 4: Full verification + merge (GATED)
- [ ] `pnpm typecheck; pnpm lint`; then `pnpm test >/tmp/v.log 2>&1; t=$?; grep -E "Tests +[0-9]+ (passed|failed)" /tmp/v.log | tail -1`. **Only if tc/lint/`t` all 0**: `git checkout main && git merge --ff-only phase43/connectors-automations-ui`. (Flaky env: re-run on mass ~60000ms timeouts / `ERR_IPC_CHANNEL_CLOSED` with tests otherwise passing; ensure Docker up.)

---

## Self-review
- **Connectors surfaced** — create + list + sync for DB / Cloud(S3,REST) / Airflow; the connectors you couldn't see are now usable. ✓
- **Automations surfaced** — list + create (event-driven follow-up actions). ✓
- **Testable** — pure `ConnectorList` jsdom-tested; views verified by typecheck+build; backends already in the green suite. ✓
- **Project-scoped** — both use the shell's `X-Project`; `key={refreshKey}` refetches on project switch. ✓
- **Deferred:** connector secrets UI, sync scheduling from the UI, automation run history view, then-edits rich editor. Flagged.
