# Phase 41 — New UI Shell (sidebar + project switcher) Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps `- [ ]`.

**Goal:** Replace the top-tab UI with a Foundry-style shell: a top bar with a **project switcher**, a **left sidebar** grouping all surfaces (PROJECT + PLATFORM), and a main panel. The API client sends the active project as `X-Project`. Existing views move into the shell; a functional **Data** surface is added (shows project scoping live); the remaining new surfaces are clearly-labelled placeholders (filled by later plans).

**Architecture:** Pure `Sidebar` + `ProjectSwitcher` components (jsdom-tested). `App.tsx` becomes the stateful shell. `api.ts` gains a module-level active-project + `X-Project` header on every request + `listProjects`/`createProject`/`datasetPreview`.

**Tech:** React 18, Vite, Vitest + @testing-library/react.

---

## Pre-flight
- [ ] **Branch:** `git checkout main && git checkout -b phase41/ui-shell`

---

## Task 1: API client — active project + project methods

**Files:** Modify `apps/web/src/api.ts`

- [ ] **Step 1: Active-project state + `X-Project` header**

Replace the `req` function and add project state at the top of the file (after the interfaces, before `req`):
```ts
let currentProjectId = 'project_default';
export function setActiveProject(id: string): void { currentProjectId = id; }
export function getActiveProject(): string { return currentProjectId; }

async function req<T>(method: string, path: string, body?: unknown, asText = false): Promise<T> {
  const headers: Record<string, string> = { 'x-project': currentProjectId };
  const init: RequestInit = { method, credentials: 'include', headers };
  if (body !== undefined) {
    headers['content-type'] = asText ? 'text/csv' : 'application/json';
    init.body = asText ? (body as string) : JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, init);
  if (!res.ok) {
    const msg = await res.json().then((j) => j.error).catch(() => `HTTP ${res.status}`);
    throw new Error(msg);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}
```

- [ ] **Step 2: Add methods** inside the `api` object (anywhere among the others):
```ts
  listProjects: () => req<{ projects: Array<{ id: string; name: string }> }>('GET', '/projects'),
  createProject: (name: string) => req<{ id: string }>('POST', '/projects', { name }),
  datasetPreview: (id: string) => req<{ rows: Record<string, unknown>[] }>('GET', `/datasets/${id}/preview`),
```
(If `listDatasets` is not already present — it was added for Governance — add `listDatasets: () => req<{ datasets: Array<{ id: string; name: string; rowCount?: number }> }>('GET', '/datasets'),`.)

---

## Task 2: Pure shell components (+ tests)

**Files:** Create `apps/web/src/components/Sidebar.tsx`, `apps/web/src/components/Sidebar.test.tsx`, `apps/web/src/components/ProjectSwitcher.tsx`, `apps/web/src/components/ProjectSwitcher.test.tsx`

- [ ] **Step 1: `components/Sidebar.tsx`**
```tsx
export interface NavItem { id: string; label: string; }
export interface NavGroup { label: string; items: NavItem[]; }

export function Sidebar({ groups, active, onSelect }: { groups: NavGroup[]; active: string; onSelect: (id: string) => void }) {
  return (
    <div className="sidebar">
      {groups.map((g) => (
        <div key={g.label} className="navgroup">
          <div className="navgroup-label">{g.label}</div>
          {g.items.map((it) => (
            <div key={it.id} className={`navitem ${active === it.id ? 'active' : ''}`} onClick={() => onSelect(it.id)}>{it.label}</div>
          ))}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: `components/Sidebar.test.tsx`**
```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Sidebar } from './Sidebar';

const groups = [
  { label: 'PROJECT', items: [{ id: 'data', label: 'Data' }, { id: 'pipelines', label: 'Pipelines' }] },
  { label: 'PLATFORM', items: [{ id: 'admin', label: 'Admin' }] },
];

describe('Sidebar', () => {
  it('renders groups + items and selects on click', () => {
    const onSelect = vi.fn();
    render(<Sidebar groups={groups} active="data" onSelect={onSelect} />);
    expect(screen.getByText('PROJECT')).toBeInTheDocument();
    expect(screen.getByText('Pipelines')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Pipelines'));
    expect(onSelect).toHaveBeenCalledWith('pipelines');
    expect(screen.getByText('Data').className).toContain('active');
  });
});
```

- [ ] **Step 3: `components/ProjectSwitcher.tsx`**
```tsx
export function ProjectSwitcher({ projects, current, onSelect, onCreate }: {
  projects: Array<{ id: string; name: string }>;
  current: string;
  onSelect: (id: string) => void;
  onCreate: (name: string) => void;
}) {
  return (
    <span className="projswitch">
      <select aria-label="project" value={current} onChange={(e) => onSelect(e.target.value)}>
        {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <button className="sec" onClick={() => { const n = window.prompt('New project name'); if (n && n.trim()) onCreate(n.trim()); }}>+ New</button>
    </span>
  );
}
```

- [ ] **Step 4: `components/ProjectSwitcher.test.tsx`**
```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ProjectSwitcher } from './ProjectSwitcher';

describe('ProjectSwitcher', () => {
  it('lists projects and selects', () => {
    const onSelect = vi.fn();
    render(<ProjectSwitcher projects={[{ id: 'project_default', name: 'Default' }, { id: 'p2', name: 'Marketing' }]} current="project_default" onSelect={onSelect} onCreate={() => {}} />);
    expect(screen.getByRole('option', { name: 'Marketing' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('project'), { target: { value: 'p2' } });
    expect(onSelect).toHaveBeenCalledWith('p2');
  });
});
```

- [ ] **Step 5: Run → PASS:** `pnpm --filter @so/web test -- Sidebar ProjectSwitcher` (timeout 120000). (May run the whole web suite — all must pass.)

---

## Task 3: Data surface + placeholder + shell

**Files:** Create `apps/web/src/views/DataView.tsx`, `apps/web/src/views/PlaceholderView.tsx`; Modify `apps/web/src/App.tsx`, `apps/web/src/styles.css`

- [ ] **Step 1: `views/DataView.tsx`** (functional — lists the active project's datasets + preview)
```tsx
import { useEffect, useState } from 'react';
import { api } from '../api';

export function DataView() {
  const [datasets, setDatasets] = useState<Array<{ id: string; name: string; rowCount?: number }>>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [sel, setSel] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { api.listDatasets().then((r) => setDatasets(r.datasets)).catch((e) => setErr((e as Error).message)); }, []);
  async function preview(id: string) { setSel(id); setErr(''); try { setRows((await api.datasetPreview(id)).rows); } catch (e) { setErr((e as Error).message); } }
  const cols = rows[0] ? Object.keys(rows[0]) : [];
  return (
    <div className="card">
      <h2>Data</h2>
      {datasets.length === 0 ? <p style={{ color: '#8a929c' }}>No datasets in this project. Upload one under "Upload &amp; model".</p> : (
        <table><thead><tr><th>Dataset</th><th>Rows</th></tr></thead>
          <tbody>{datasets.map((d) => <tr key={d.id} className={sel === d.id ? 'sel' : ''} onClick={() => preview(d.id)} style={{ cursor: 'pointer' }}><td>{d.name}</td><td>{d.rowCount ?? ''}</td></tr>)}</tbody>
        </table>
      )}
      {rows.length > 0 ? (
        <table style={{ marginTop: 12 }}><thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c}>{r[c] === null || r[c] === undefined ? '' : String(r[c])}</td>)}</tr>)}</tbody>
        </table>
      ) : null}
      {err ? <div className="err">{err}</div> : null}
    </div>
  );
}
```

- [ ] **Step 2: `views/PlaceholderView.tsx`**
```tsx
export function PlaceholderView({ title }: { title: string }) {
  return (
    <div className="card">
      <h2>{title}</h2>
      <p style={{ color: '#8a929c' }}>This surface's backend API is already built and tested — its UI is being wired up next.</p>
    </div>
  );
}
```

- [ ] **Step 3: Rewrite `apps/web/src/App.tsx` as the shell**
```tsx
import { useEffect, useState } from 'react';
import { api, setActiveProject, type User } from './api';
import { LoginForm } from './components/LoginForm';
import { Sidebar, type NavGroup } from './components/Sidebar';
import { ProjectSwitcher } from './components/ProjectSwitcher';
import { SetupView } from './views/SetupView';
import { ExplorerView } from './views/ExplorerView';
import { AdminView } from './views/AdminView';
import { DashboardsView } from './views/DashboardsView';
import { AskView } from './views/AskView';
import { AppsView } from './views/AppsView';
import { GovernanceView } from './views/GovernanceView';
import { DataView } from './views/DataView';
import { PlaceholderView } from './views/PlaceholderView';

const GROUPS: NavGroup[] = [
  { label: 'PROJECT', items: [
    { id: 'data', label: 'Data' }, { id: 'setup', label: 'Upload & model' }, { id: 'pipelines', label: 'Pipelines' },
    { id: 'connectors', label: 'Connectors' }, { id: 'apps', label: 'Apps' }, { id: 'automations', label: 'Automations' },
  ] },
  { label: 'PLATFORM', items: [
    { id: 'explorer', label: 'Ontology Explorer' }, { id: 'lineage', label: 'Lineage' }, { id: 'catalog', label: 'Catalog' },
    { id: 'dashboards', label: 'Dashboards' }, { id: 'governance', label: 'Governance' }, { id: 'apisdk', label: 'API & SDK' },
    { id: 'ask', label: 'Ask' }, { id: 'admin', label: 'Admin' },
  ] },
];

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loginErr, setLoginErr] = useState('');
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [project, setProject] = useState('project_default');
  const [view, setView] = useState('explorer');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => { api.me().then((r) => setUser(r.user)).catch(() => setUser(null)); }, []);
  useEffect(() => { if (user) api.listProjects().then((r) => setProjects(r.projects)).catch(() => {}); }, [user]);

  async function doLogin(email: string, password: string) {
    setLoginErr('');
    try { await api.login(email, password); setUser((await api.me()).user); }
    catch (e) { setLoginErr((e as Error).message); }
  }
  async function doLogout() { await api.logout().catch(() => {}); setUser(null); }
  function switchProject(id: string) { setActiveProject(id); setProject(id); setRefreshKey((k) => k + 1); }
  async function createProject(name: string) { try { const { id } = await api.createProject(name); setProjects((await api.listProjects()).projects); switchProject(id); } catch { /* ignore */ } }

  if (!user) return <div className="wrap"><LoginForm onSubmit={doLogin} error={loginErr} /></div>;

  const surface = (() => {
    switch (view) {
      case 'data': return <DataView key={refreshKey} />;
      case 'setup': return <SetupView onModeled={() => { setRefreshKey((k) => k + 1); setView('explorer'); }} />;
      case 'apps': return <AppsView key={refreshKey} />;
      case 'explorer': return <ExplorerView key={refreshKey} />;
      case 'dashboards': return <DashboardsView />;
      case 'governance': return <GovernanceView />;
      case 'ask': return <AskView />;
      case 'admin': return <AdminView />;
      case 'pipelines': return <PlaceholderView title="Pipelines" />;
      case 'connectors': return <PlaceholderView title="Connectors" />;
      case 'automations': return <PlaceholderView title="Automations" />;
      case 'lineage': return <PlaceholderView title="Lineage" />;
      case 'catalog': return <PlaceholderView title="Catalog" />;
      case 'apisdk': return <PlaceholderView title="API & SDK" />;
      default: return <ExplorerView key={refreshKey} />;
    }
  })();

  return (
    <div className="shell">
      <div className="topbar">
        <b>&#9651; SoftwareOntology</b>
        <ProjectSwitcher projects={projects} current={project} onSelect={switchProject} onCreate={createProject} />
        <span className="spacer" />
        <span>{user.email}</span>
        <button className="sec" onClick={doLogout}>Sign out</button>
      </div>
      <div className="body">
        <Sidebar groups={GROUPS} active={view} onSelect={setView} />
        <div className="main-panel">{surface}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Styles — append to `apps/web/src/styles.css`**

Add shell styles (keep existing rules). Use the project's existing dark palette (sample `.nav`/`.card` colours from the file and match):
```css
.shell { display: flex; flex-direction: column; height: 100vh; }
.topbar { display: flex; align-items: center; gap: 14px; padding: 10px 16px; background: #11161d; color: #fff; }
.topbar .spacer { flex: 1; }
.projswitch select { margin-right: 6px; }
.body { display: flex; flex: 1; min-height: 0; }
.sidebar { width: 220px; background: #161b22; border-right: 1px solid #2a2f37; padding: 12px 0; overflow-y: auto; }
.navgroup { margin-bottom: 14px; }
.navgroup-label { font-size: 11px; letter-spacing: .08em; color: #8a929c; padding: 4px 16px; }
.navitem { padding: 7px 16px; cursor: pointer; color: #c9d1d9; font-size: 14px; }
.navitem:hover { background: #1f2630; }
.navitem.active { background: #1f6feb22; color: #fff; border-left: 2px solid #1f6feb; padding-left: 14px; }
.main-panel { flex: 1; overflow-y: auto; padding: 20px; }
```

- [ ] **Step 5: Verify the web package:**
```
pnpm --filter @so/web typecheck   # exit 0
pnpm --filter @so/web test        # all pass (existing + Sidebar + ProjectSwitcher)
pnpm --filter @so/web build       # vite build succeeds
```
(timeout 180000). No unused imports. NOTE: do NOT add an `eslint-disable react-hooks/exhaustive-deps` comment — that rule isn't configured here and the directive errors lint; the `useEffect`s are fine as-is.

- [ ] **Step 6: Commit:** `git add -A && git commit -m "feat(web): new UI shell — sidebar + project switcher; Data surface; surfaces scaffolded"`

---

## Task 4: Full verification + merge (GATED)
- [ ] `pnpm typecheck; pnpm lint`; then `pnpm test >/tmp/v.log 2>&1; t=$?; grep -E "Tests +[0-9]+ (passed|failed)" /tmp/v.log | tail -1`. **Only if tc/lint/`t` all 0**: `git checkout main && git merge --ff-only phase41/ui-shell`. (No backend change; web tests + suite must stay green. If mass ~60000ms timeouts or `ERR_IPC_CHANNEL_CLOSED` appear with tests otherwise passing, that's the flaky env — re-run; ensure Docker up.)

---

## Self-review
- **Complete UI rethink (structure)** — left sidebar grouping all surfaces (PROJECT + PLATFORM) + a working project switcher; the old top tabs are gone. ✓
- **Project switching wired** — `X-Project` header on every API call; switching re-keys project-scoped surfaces (Data, Apps, Explorer) to refetch. ✓
- **Surfaces present** — existing views (Explorer, Upload&model, Apps, Dashboards, Governance, Ask, Admin) moved in; **Data** is functional (shows the active project's datasets, proving scoping); Pipelines/Connectors/Automations/Lineage/Catalog/API&SDK are labelled placeholders to be filled by Plans 42+. ✓
- **Testable** — pure `Sidebar` + `ProjectSwitcher` jsdom-tested. ✓
- **Deferred (next plans):** functional Pipelines (DAG builder/runs/schedule), Connectors (create/sync), Lineage, Catalog, API&SDK surfaces; Explorer filtered by project. Flagged.
