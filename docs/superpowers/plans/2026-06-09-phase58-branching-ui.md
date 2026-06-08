# Phase 58 — Branching UI Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps `- [ ]`.

**Goal:** Surface Plan 57's branching: a global **branch switcher** in the top bar (the API client sends `X-Branch` on every request, like `X-Project`), and a **Branches** console surface to create, review (diff), merge, and discard branches. With the switcher on a branch, Object Explorer/Ask resolve — and Actions write — on that branch automatically.

**Architecture:** `api.ts` gains a module-level `currentBranch` + `x-branch` header + branch verbs. `TopBar` gains an optional branch `<select>`. A `BranchDiff` pure component + a `BranchesView`. `App` holds branch state, keys branch-sensitive surfaces by branch so they re-fetch on switch.

---

## Pre-flight
- [ ] **Branch:** `git checkout main && git checkout -b phase58/branching-ui`

---

## Task 1: API — `x-branch` header + branch verbs

**Files:** Modify `apps/web/src/api.ts`

- [ ] **Step 1** — mirror the existing `currentProjectId`/`setActiveProject` pattern: add module-level branch state + accessors and send the header in `req()`:
```ts
let currentBranch = 'main';
export function setActiveBranch(b: string): void { currentBranch = b || 'main'; }
export function getActiveBranch(): string { return currentBranch; }
```
In `req()` where `headers['x-project'] = currentProjectId` is set, also set `headers['x-branch'] = currentBranch;`.

- [ ] **Step 2** — add branch verbs to the `api` object:
```ts
  listBranches: () => req<{ branches: Array<{ name: string; status: string; createdAt: string | null }> }>('GET', '/ontology/branches'),
  createBranch: (name: string) => req<{ ok: boolean }>('POST', '/ontology/branches', { name }),
  branchDiff: (name: string) => req<{ edits: Array<{ objectType: string; primaryKey: string; property: string; value: string | null }>; creates: Array<{ objectType: string; primaryKey: string }> }>('GET', `/ontology/branches/${name}/diff`),
  mergeBranch: (name: string) => req<{ merged: number }>('POST', `/ontology/branches/${name}/merge`),
  deleteBranch: (name: string) => req<{ ok: boolean }>('DELETE', `/ontology/branches/${name}`),
```

---

## Task 2: TopBar branch selector (+ test)

**Files:** Modify `apps/web/src/components/TopBar.tsx`, `apps/web/src/components/TopBar.test.tsx`

- [ ] **Step 1: `TopBar.tsx`** — READ it. Add optional props `branch?: string; branches?: Array<{ name: string; status: string }>; onBranchChange?: (b: string) => void;`. Render a selector (before the search box) ONLY when `branches` is provided:
```tsx
{branches && onBranchChange ? (
  <select aria-label="branch" className="branchsel" value={branch ?? 'main'} onChange={(e) => onBranchChange(e.target.value)} title="Active branch">
    {branches.map((b) => <option key={b.name} value={b.name}>⎇ {b.name}</option>)}
  </select>
) : null}
```

- [ ] **Step 2: `TopBar.test.tsx`** — add a case:
```tsx
  it('switches branch', () => {
    const onBranchChange = vi.fn();
    render(<TopBar breadcrumb={['Console']} userEmail="a@x.com" onSignOut={() => {}} branch="main" branches={[{ name: 'main', status: 'main' }, { name: 'feat', status: 'open' }]} onBranchChange={onBranchChange} />);
    fireEvent.change(screen.getByLabelText('branch'), { target: { value: 'feat' } });
    expect(onBranchChange).toHaveBeenCalledWith('feat');
  });
```
(Keep existing TopBar tests intact — the new props are optional.)

- [ ] **Step 3: `styles.css`** — append:
```css
.branchsel{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:5px 8px;font-size:13px;color:var(--ink)}
```

- [ ] **Step 4: Run → PASS:** `pnpm --filter @so/web test -- TopBar` (the run executes the whole web suite; ensure all pass).

---

## Task 3: `BranchDiff` component (+ test)

**Files:** Create `apps/web/src/components/BranchDiff.tsx` (+ `.test.tsx`)

- [ ] **Step 1: `BranchDiff.tsx`**
```tsx
export type Edit = { objectType: string; primaryKey: string; property: string; value: string | null };
export type Create = { objectType: string; primaryKey: string };
export function BranchDiff({ edits, creates }: { edits: Edit[]; creates: Create[] }) {
  if (edits.length === 0 && creates.length === 0) return <p className="muted">No changes on this branch yet.</p>;
  return (
    <div>
      {edits.length ? (
        <>
          <h4>Edits ({edits.length})</h4>
          <table><thead><tr><th>Type</th><th>Key</th><th>Property</th><th>New value</th></tr></thead>
            <tbody>{edits.map((e, i) => (<tr key={i}><td>{e.objectType}</td><td>{e.primaryKey}</td><td>{e.property}</td><td>{e.value}</td></tr>))}</tbody>
          </table>
        </>
      ) : null}
      {creates.length ? (
        <>
          <h4>New objects ({creates.length})</h4>
          <ul>{creates.map((c, i) => (<li key={i}>{c.objectType}: {c.primaryKey}</li>))}</ul>
        </>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: `BranchDiff.test.tsx`**
```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { BranchDiff } from './BranchDiff';
describe('BranchDiff', () => {
  it('renders edits with a count', () => {
    render(<BranchDiff edits={[{ objectType: 'Flight', primaryKey: 'FL-1', property: 'status', value: 'Delayed' }]} creates={[]} />);
    expect(screen.getByText('Edits (1)')).toBeInTheDocument();
    expect(screen.getByText('Delayed')).toBeInTheDocument();
  });
  it('shows an empty state', () => {
    render(<BranchDiff edits={[]} creates={[]} />);
    expect(screen.getByText(/No changes on this branch yet/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run → PASS:** `pnpm --filter @so/web test` (timeout 120000).

---

## Task 4: `BranchesView` + App wiring + help

**Files:** Create `apps/web/src/views/BranchesView.tsx`; Modify `apps/web/src/App.tsx`, `apps/web/src/help.ts`

- [ ] **Step 1: `BranchesView.tsx`**
```tsx
import { useEffect, useState } from 'react';
import { api } from '../api';
import { BranchDiff, type Edit, type Create } from '../components/BranchDiff';
export function BranchesView({ notify, onChanged }: { notify: (m: string, k?: 'ok' | 'err') => void; onChanged: () => void }) {
  const [branches, setBranches] = useState<Array<{ name: string; status: string }>>([]);
  const [name, setName] = useState('');
  const [sel, setSel] = useState('');
  const [diff, setDiff] = useState<{ edits: Edit[]; creates: Create[] } | null>(null);
  async function reload() { try { setBranches((await api.listBranches()).branches); } catch (e) { notify((e as Error).message, 'err'); } }
  useEffect(() => { reload(); }, []);
  useEffect(() => { if (sel && sel !== 'main') { api.branchDiff(sel).then(setDiff).catch(() => setDiff(null)); } else setDiff(null); }, [sel]);
  async function create() { if (!name.trim()) return; try { await api.createBranch(name.trim()); notify('Branch created.'); setName(''); await reload(); onChanged(); } catch (e) { notify((e as Error).message, 'err'); } }
  async function merge() { try { const r = await api.mergeBranch(sel); notify(`Merged ${r.merged} change(s) into main.`); setSel(''); await reload(); onChanged(); } catch (e) { notify((e as Error).message, 'err'); } }
  async function discard() { if (!window.confirm(`Discard branch “${sel}” and its changes?`)) return; try { await api.deleteBranch(sel); notify('Branch discarded.'); setSel(''); await reload(); onChanged(); } catch (e) { notify((e as Error).message, 'err'); } }
  return (
    <div className="card pad">
      <h2>Branches</h2>
      <p className="muted">Branches isolate edits made through Actions on top of the shared base data. Switch to a branch (top bar) to work on it, then merge it into main here.</p>
      <div style={{ display: 'flex', gap: 8, margin: '12px 0' }}>
        <input aria-label="branch name" value={name} onChange={(e) => setName(e.target.value)} placeholder="feature-x" />
        <button onClick={create}>Create branch</button>
      </div>
      <table><thead><tr><th>Branch</th><th>Status</th><th /></tr></thead>
        <tbody>{branches.map((b) => (
          <tr key={b.name}><td><strong>{b.name}</strong></td><td>{b.status}</td>
            <td>{b.name !== 'main' && b.status !== 'merged' ? <button className="sec" onClick={() => setSel(b.name)}>Review</button> : null}</td></tr>
        ))}</tbody>
      </table>
      {sel && sel !== 'main' ? (
        <div style={{ marginTop: 16 }}>
          <h3>Changes on {sel}</h3>
          {diff ? <BranchDiff edits={diff.edits} creates={diff.creates} /> : <p className="muted">Loading…</p>}
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}><button onClick={merge}>Merge into main</button><button className="sec" onClick={discard}>Discard</button></div>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: `App.tsx`** — READ it. Changes:
  - Imports: `import { BranchesView } from './views/BranchesView';` and add `setActiveBranch` to the `../api` import.
  - `CONSOLE_ITEMS`: add `{ id: 'branches', label: 'Branches', icon: '⎇' }` (place after `explorer`).
  - State: `const [branch, setBranch] = useState('main');` and `const [branches, setBranches] = useState<Array<{ name: string; status: string }>>([]);`
  - Loader (effect, above the `if (!user)` early return): `useEffect(() => { if (user) api.listBranches().then((r) => setBranches(r.branches)).catch(() => {}); }, [user]);`
  - Helper: `function reloadBranches() { api.listBranches().then((r) => setBranches(r.branches)).catch(() => {}); }`
  - Helper: `function changeBranch(b: string) { setActiveBranch(b); setBranch(b); }`
  - `<TopBar ... />`: add props `branch={branch} branches={branches} onBranchChange={changeBranch}`.
  - Console `switch`: add `case 'branches': return <BranchesView notify={notify} onChanged={reloadBranches} />;`
  - Make branch-sensitive surfaces re-fetch on switch by keying them with `branch`: render the console `explorer` case as `<ObjectExplorer key={branch} />`, the `ask` case as `<AskView key={branch} />`, and the `ontology` case as `<OntologyManager key={branch} />`.

- [ ] **Step 3: `help.ts`** — add a `'console:branches'` entry:
```ts
  'console:branches': { title: 'Branches', steps: [
    'A branch isolates edits you make through Actions, on top of the shared base data.',
    'Create a branch here, then switch to it using the ⎇ selector in the top bar.',
    'Work in the Object Explorer (run actions) — your changes stay on the branch.',
    'Come back here to review the diff and Merge into main, or Discard the branch.',
  ]},
```

- [ ] **Step 4: Verify:** `pnpm --filter @so/web typecheck` (0); `pnpm --filter @so/web test` (all pass incl. BranchDiff + TopBar); `pnpm --filter @so/web build`. No unused imports; no `eslint-disable react-hooks/exhaustive-deps`.
- [ ] **Step 5: Commit:** `git add -A && git commit -m "feat(web): branch switcher + Branches surface (create/review/merge/discard)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"`

---

## Task 5: Full verification + merge (GATED)
- [ ] Run:
```bash
cd /Users/sumitagrawal/CODE/sumit/SoftwareOntology
pnpm run infra:up && pnpm run infra:seed
pnpm typecheck; tc=$?
pnpm lint; lint=$?
pnpm test >/tmp/p58.log 2>&1; t=$?
grep -E "Tests +[0-9]+ (passed|failed)" /tmp/p58.log | tail -1
echo "tc=$tc lint=$lint t=$t"
if [ $tc -eq 0 ] && [ $lint -eq 0 ] && [ $t -eq 0 ]; then git checkout main && git merge --ff-only phase58/branching-ui && echo MERGED; else echo "NOT MERGING"; fi
```
(Flaky env: re-run once on mass ~60000ms timeouts / `ERR_IPC_CHANNEL_CLOSED` after confirming `docker info`.)

---

## Self-review
- **Switcher** — `TopBar` branch `<select>`; `changeBranch` sets the api `x-branch` header + re-keys branch-sensitive surfaces to re-fetch. ✓
- **Branches surface** — create / review-diff / merge / discard, with toast feedback; `main` shown but not mergeable/deletable. ✓
- **End-to-end** — switch to a branch → Object Explorer resolves it + Actions write to it (header) → review + merge here. ✓
- **Tested** — `TopBar` switch test + `BranchDiff` test. ✓
- **Completes Pillar 3.** Pipeline/Parquet-output branching remains a flagged future extension.
