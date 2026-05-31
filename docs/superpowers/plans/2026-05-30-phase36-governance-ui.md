# Phase 36 — Governance UI Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps `- [ ]`.

**Goal:** A **Governance** tab in the web app: create markings, apply them to datasets, grant clearances to roles, and see your own clearances (cleared vs. not). Completes governance as a full vertical slice (UI → API → DB), usable end-to-end in the browser.

**Architecture:** Follows existing apps/web patterns — flat `api` methods, a stateful `GovernanceView`, and a pure `MarkingsTable` component (jsdom-tested like `ObjectsTable`/`AppRuntime`). New **Governance** nav tab.

**Tech:** React 18, Vite, Vitest + @testing-library/react.

---

## Pre-flight
- [ ] **Branch:** `git checkout main && git checkout -b phase36/governance-ui`

---

## Task 1: API client + components + view + nav

**Files:** Modify `apps/web/src/api.ts`, `apps/web/src/App.tsx`; Create `apps/web/src/components/MarkingsTable.tsx`, `apps/web/src/components/MarkingsTable.test.tsx`, `apps/web/src/views/GovernanceView.tsx`

- [ ] **Step 1: API methods — modify `apps/web/src/api.ts`**

Add these inside the `api` object (after the `deleteApp` line, before the closing `};`):
```ts
  listDatasets: () => req<{ datasets: Array<{ id: string; name: string }> }>('GET', '/datasets'),
  listRoles: () => req<{ roles: Array<{ id: string; name: string }> }>('GET', '/admin/roles'),
  listMarkings: () => req<{ markings: Array<{ id: string; name: string }> }>('GET', '/governance/markings'),
  createMarking: (name: string) => req<{ id: string }>('POST', '/governance/markings', { name }),
  applyMarking: (markingId: string, datasetId: string) => req<{ ok: boolean }>('POST', `/governance/markings/${markingId}/datasets/${datasetId}`),
  grantMarking: (markingId: string, roleId: string) => req<{ ok: boolean }>('POST', `/governance/markings/${markingId}/roles/${roleId}`),
  myClearances: () => req<{ clearances: Array<{ id: string; name: string }> }>('GET', '/governance/me/clearances'),
```
(If `GET /admin/roles` returns a different role shape, adapt the `listRoles` type to match — it needs at least `id` and `name`.)

- [ ] **Step 2: Create `apps/web/src/components/MarkingsTable.tsx`** (pure)
```tsx
export function MarkingsTable({ markings, clearedIds }: { markings: Array<{ id: string; name: string }>; clearedIds: Set<string> }) {
  if (markings.length === 0) return <p style={{ color: '#8a929c' }}>No markings yet.</p>;
  return (
    <table>
      <thead><tr><th>Marking</th><th>Your clearance</th></tr></thead>
      <tbody>
        {markings.map((m) => (
          <tr key={m.id}><td>{m.name}</td><td>{clearedIds.has(m.id) ? '✓ cleared' : '— not cleared'}</td></tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 3: Create `apps/web/src/components/MarkingsTable.test.tsx`**
```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MarkingsTable } from './MarkingsTable';

describe('MarkingsTable', () => {
  it('marks each row cleared or not, per the user clearances', () => {
    render(<MarkingsTable markings={[{ id: '1', name: 'PII' }, { id: '2', name: 'SECRET' }]} clearedIds={new Set(['1'])} />);
    const pii = screen.getByText('PII').closest('tr')!;
    const secret = screen.getByText('SECRET').closest('tr')!;
    expect(pii.textContent).toContain('✓');            // cleared
    expect(secret.textContent).toContain('not cleared'); // not cleared
  });
  it('shows an empty state', () => {
    render(<MarkingsTable markings={[]} clearedIds={new Set()} />);
    expect(screen.getByText(/no markings/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run the component test → PASS:** `pnpm --filter @so/web test -- MarkingsTable` (timeout 120000). (Note: the filter may run the whole web suite; that's fine — all must pass.)

- [ ] **Step 5: Create `apps/web/src/views/GovernanceView.tsx`** (stateful)
```tsx
import { useEffect, useState } from 'react';
import { api } from '../api';
import { MarkingsTable } from '../components/MarkingsTable';

type Named = { id: string; name: string };

export function GovernanceView() {
  const [markings, setMarkings] = useState<Named[]>([]);
  const [datasets, setDatasets] = useState<Named[]>([]);
  const [roles, setRoles] = useState<Named[]>([]);
  const [clearances, setClearances] = useState<Named[]>([]);
  const [name, setName] = useState('');
  const [mkSel, setMkSel] = useState('');
  const [dsSel, setDsSel] = useState('');
  const [roleSel, setRoleSel] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  async function reload() {
    try {
      const [m, d, r, c] = await Promise.all([api.listMarkings(), api.listDatasets(), api.listRoles(), api.myClearances()]);
      setMarkings(m.markings); setDatasets(d.datasets); setRoles(r.roles); setClearances(c.clearances);
      if (!mkSel && m.markings[0]) setMkSel(m.markings[0].id);
      if (!dsSel && d.datasets[0]) setDsSel(d.datasets[0].id);
      if (!roleSel && r.roles[0]) setRoleSel(r.roles[0].id);
    } catch (e) { setErr((e as Error).message); }
  }
  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function create() { setErr(''); setMsg(''); try { await api.createMarking(name); setName(''); await reload(); setMsg('Marking created.'); } catch (e) { setErr((e as Error).message); } }
  async function apply() { setErr(''); setMsg(''); try { await api.applyMarking(mkSel, dsSel); setMsg('Marking applied to dataset.'); } catch (e) { setErr((e as Error).message); } }
  async function grant() { setErr(''); setMsg(''); try { await api.grantMarking(mkSel, roleSel); await reload(); setMsg('Clearance granted to role.'); } catch (e) { setErr((e as Error).message); } }

  const clearedIds = new Set(clearances.map((c) => c.id));
  return (
    <div className="card">
      <h2>Governance — markings &amp; clearances</h2>
      <p style={{ color: '#8a929c' }}>Markings are mandatory: reading a marked dataset requires clearance for every marking on it (not bypassed by admin). Derived datasets inherit their sources' markings.</p>

      <h3>Markings</h3>
      <MarkingsTable markings={markings} clearedIds={clearedIds} />
      <div style={{ margin: '10px 0' }}>
        <input aria-label="new marking" value={name} onChange={(e) => setName(e.target.value)} placeholder="PII / SECRET / …" />
        <button onClick={create}>Create marking</button>
      </div>

      <h3>Apply a marking to a dataset</h3>
      <select aria-label="apply marking" value={mkSel} onChange={(e) => setMkSel(e.target.value)}>{markings.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
      <select aria-label="dataset" value={dsSel} onChange={(e) => setDsSel(e.target.value)}>{datasets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
      <button onClick={apply}>Apply</button>

      <h3>Grant clearance to a role</h3>
      <select aria-label="grant marking" value={mkSel} onChange={(e) => setMkSel(e.target.value)}>{markings.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
      <select aria-label="role" value={roleSel} onChange={(e) => setRoleSel(e.target.value)}>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
      <button onClick={grant}>Grant</button>

      {msg ? <div style={{ color: '#3fb950', marginTop: 10 }}>{msg}</div> : null}
      {err ? <div className="err">{err}</div> : null}
    </div>
  );
}
```

- [ ] **Step 6: Nav — modify `apps/web/src/App.tsx`**

Add the import: `import { GovernanceView } from './views/GovernanceView';`
Extend the `View` union with `| 'governance'`.
Add a tab (after the `apps` tab): `<div className={`tab ${view === 'governance' ? 'active' : ''}`} onClick={() => setView('governance')}>Governance</div>`
Add to the view switch (before the final `: <ExplorerView .../>`): `: view === 'governance' ? <GovernanceView />`

- [ ] **Step 7: Verify the web package — typecheck, test, build:**
```
pnpm --filter @so/web typecheck   # exit 0
pnpm --filter @so/web test        # all web tests pass (existing + MarkingsTable)
pnpm --filter @so/web build       # vite build succeeds
```
(timeout 180000). No unused imports.

- [ ] **Step 8: Commit:** `git add -A && git commit -m "feat(web): governance UI — markings, apply, grant clearance, view (Governance tab)"`

---

## Task 2: Full verification + merge
- [ ] `pnpm run infra:up && pnpm run infra:seed && pnpm typecheck; pnpm lint`. Then GATE the test: `pnpm test >/tmp/v.log 2>&1; t=$?; grep -E "Tests +[0-9]+ (passed|failed)" /tmp/v.log | tail -1`. **Only if tc/lint/`t` all 0**: `git checkout main && git merge --ff-only phase36/governance-ui`.

---

## Self-review
- **End-to-end (UI)** — governance is now usable in the browser: create markings, apply to datasets, grant clearances, see your clearances; completes the UI→API→DB slice. ✓
- **Testable** — `MarkingsTable` is a pure component (cleared/not-cleared rendering) tested under jsdom, matching the established pattern. ✓
- **Pattern-consistent** — flat `api` methods; `card`/`err`/`tab` classes; stateful view like `AppsView`/`DashboardsView`; new nav tab. ✓
- **Merge gated on green.** ✓
- **Deferred:** showing a dataset's markings inline in the dataset/explorer views; revoking clearances/markings from the UI; a per-user clearance admin screen; marking color/badges. Flagged.
