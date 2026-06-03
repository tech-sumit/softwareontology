# Phase 46 — UI Hybrid Build (workspace rail + rich home + slim top bar) Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps `- [ ]`.

**Goal:** Build the approved **Hybrid (Option 1 + 2)** UI: a workspace **rail** of project avatars + ⌂ Console, a project **sidebar**, a slim **top bar** (breadcrumb + global search + user/sign-out), and a **rich project Home** (hero · KPI cards · recent-runs activity feed · recent-datasets). Opens **inside a project**; shared assets on the **Console**. The premium design system is already in `styles.css` (prior commit on this branch).

**Architecture:** Pure `WorkspaceRail` + `ContextSidebar` + `TopBar` (jsdom-tested); `ConsoleHome` + rich `ProjectOverview`; `App.tsx` rebuilt as `rail + sidebar + main(topbar + content)`. Reuses all existing surface views. Removes `Sidebar`/`ProjectSwitcher`.

---

## Pre-flight
- [ ] On branch `phase46/ui-hybrid` (already created; `styles.css` already committed). Confirm: `git branch --show-current` → `phase46/ui-hybrid`.

---

## Task 1: Pure components (+ tests)

- [ ] **`apps/web/src/components/WorkspaceRail.tsx`**
```tsx
const COLORS = ['#4763e4', '#0f7a48', '#9a5b00', '#a23b72', '#0e7490', '#697489', '#b4530a', '#5b21b6'];
export function colorFor(id: string): string {
  let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length]!;
}
export interface RailProject { id: string; name: string; }
export function WorkspaceRail({ projects, activeProjectId, area, userInitial, onConsole, onSelectProject, onNewProject }: {
  projects: RailProject[]; activeProjectId: string; area: 'console' | 'project'; userInitial: string;
  onConsole: () => void; onSelectProject: (id: string) => void; onNewProject: () => void;
}) {
  return (
    <div className="rail">
      <div className="logo">◆</div>
      <button className={`ico ${area === 'console' ? 'active' : ''}`} title="Console" aria-label="Console" onClick={onConsole}>⌂</button>
      <div className="sep" />
      {projects.map((p) => (
        <button key={p.id} className={`av ${area === 'project' && p.id === activeProjectId ? 'active' : ''}`} style={{ background: colorFor(p.id) }} title={p.name} aria-label={`project ${p.name}`} onClick={() => onSelectProject(p.id)}>{p.name.slice(0, 1).toUpperCase()}</button>
      ))}
      <button className="ico" title="New project" aria-label="New project" onClick={onNewProject}>＋</button>
      <div className="spacer" />
      <div className="av" style={{ background: '#2b3650' }}>{userInitial}</div>
    </div>
  );
}
```

- [ ] **`apps/web/src/components/WorkspaceRail.test.tsx`**
```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { WorkspaceRail } from './WorkspaceRail';
describe('WorkspaceRail', () => {
  it('renders avatars + console and fires callbacks', () => {
    const onConsole = vi.fn(), onSelectProject = vi.fn(), onNewProject = vi.fn();
    render(<WorkspaceRail projects={[{ id: 'project_default', name: 'Default' }, { id: 'p2', name: 'Marketing' }]} activeProjectId="p2" area="project" userInitial="A" onConsole={onConsole} onSelectProject={onSelectProject} onNewProject={onNewProject} />);
    fireEvent.click(screen.getByLabelText('Console')); expect(onConsole).toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('project Marketing')); expect(onSelectProject).toHaveBeenCalledWith('p2');
    fireEvent.click(screen.getByLabelText('New project')); expect(onNewProject).toHaveBeenCalled();
    expect(screen.getByLabelText('project Marketing').className).toContain('active');
  });
});
```

- [ ] **`apps/web/src/components/ContextSidebar.tsx`**
```tsx
export interface SideItem { id: string; label: string; icon?: string; }
export function ContextSidebar({ header, items, active, onSelect }: {
  header: { title: string; subtitle?: string; dotColor?: string };
  items: SideItem[]; active: string; onSelect: (id: string) => void;
}) {
  return (
    <div className="side">
      <div className="phead">
        {header.dotColor ? <div className="pdot" style={{ background: header.dotColor }}>{header.title.slice(0, 1).toUpperCase()}</div> : null}
        <div><div className="pname">{header.title}</div>{header.subtitle ? <div className="psub">{header.subtitle}</div> : null}</div>
      </div>
      {items.map((it) => (
        <div key={it.id} className={`item ${active === it.id ? 'active' : ''}`} onClick={() => onSelect(it.id)}>{it.icon ? <span className="i">{it.icon}</span> : null}{it.label}</div>
      ))}
    </div>
  );
}
```

- [ ] **`apps/web/src/components/ContextSidebar.test.tsx`**
```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ContextSidebar } from './ContextSidebar';
describe('ContextSidebar', () => {
  it('renders header + items and selects', () => {
    const onSelect = vi.fn();
    render(<ContextSidebar header={{ title: 'Marketing', subtitle: 'Project workspace', dotColor: '#4763e4' }} items={[{ id: 'overview', label: 'Overview' }, { id: 'data', label: 'Data' }]} active="overview" onSelect={onSelect} />);
    expect(screen.getByText('Marketing')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Data')); expect(onSelect).toHaveBeenCalledWith('data');
    expect(screen.getByText('Overview').className).toContain('active');
  });
});
```

- [ ] **`apps/web/src/components/TopBar.tsx`**
```tsx
export function TopBar({ breadcrumb, userEmail, onSignOut }: { breadcrumb: string[]; userEmail: string; onSignOut: () => void }) {
  return (
    <div className="topbar2">
      <div className="crumb2">
        {breadcrumb.map((b, i) => (
          <span key={i}>{i > 0 ? <span className="sepc">/</span> : null}<span className={i === breadcrumb.length - 1 ? 'cur' : ''}>{b}</span></span>
        ))}
      </div>
      <div className="spacer" />
      <input className="search2" placeholder="Search…" aria-label="search" />
      <span className="muted" style={{ fontSize: 13 }}>{userEmail}</span>
      <button className="sec" onClick={onSignOut}>Sign out</button>
    </div>
  );
}
```

- [ ] **`apps/web/src/components/TopBar.test.tsx`**
```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TopBar } from './TopBar';
describe('TopBar', () => {
  it('renders breadcrumb + signs out', () => {
    const onSignOut = vi.fn();
    render(<TopBar breadcrumb={['Console', 'Marketing', 'Overview']} userEmail="a@x.com" onSignOut={onSignOut} />);
    expect(screen.getByText('Marketing')).toBeInTheDocument();
    expect(screen.getByText('Overview').className).toContain('cur');
    fireEvent.click(screen.getByText('Sign out')); expect(onSignOut).toHaveBeenCalled();
  });
});
```

- [ ] **Run → PASS:** `pnpm --filter @so/web test -- WorkspaceRail ContextSidebar TopBar` (timeout 120000).

---

## Task 2: Console + rich Project Overview (no outer `.content` — `App` provides it)

- [ ] **`apps/web/src/views/ConsoleHome.tsx`**
```tsx
import { colorFor } from '../components/WorkspaceRail';
const SHARED = [
  { id: 'ontology', icon: '◎', name: 'Ontology', desc: 'Object types, links, actions' },
  { id: 'lineage', icon: '⇲', name: 'Lineage', desc: 'Data provenance' },
  { id: 'catalog', icon: '≣', name: 'Catalog', desc: 'Search & audit log' },
  { id: 'dashboards', icon: '▦', name: 'Dashboards', desc: 'Aggregations' },
  { id: 'governance', icon: '🛡', name: 'Governance', desc: 'Markings & clearances' },
  { id: 'apisdk', icon: '{ }', name: 'API & SDK', desc: 'Endpoints & typed client' },
  { id: 'ask', icon: '✦', name: 'Ask · AIP', desc: 'Ask over the ontology' },
  { id: 'admin', icon: '⚙', name: 'Admin', desc: 'Users & roles' },
];
export function ConsoleHome({ projects, onOpenProject, onNewProject, onOpenSurface }: {
  projects: Array<{ id: string; name: string }>; onOpenProject: (id: string) => void; onNewProject: () => void; onOpenSurface: (id: string) => void;
}) {
  return (
    <>
      <h1 className="h1">Console</h1>
      <p className="sub">Shared platform assets &amp; all projects</p>
      <div className="sec"><h3>Projects</h3>
        <div className="grid pcards">
          {projects.map((p) => (
            <div key={p.id} className="card pcard" onClick={() => onOpenProject(p.id)}>
              <div className="ph"><div className="pdot" style={{ background: colorFor(p.id) }}>{p.name.slice(0, 1).toUpperCase()}</div><div className="pn">{p.name}</div></div>
              <div className="sub" style={{ margin: 0, fontSize: 13 }}>Open workspace →</div>
            </div>
          ))}
          <div className="card pcard" style={{ borderStyle: 'dashed', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--faint)', fontWeight: 600 }} onClick={onNewProject}>＋ New project</div>
        </div>
      </div>
      <div className="sec"><h3>Shared · Platform</h3>
        <div className="grid tiles">
          {SHARED.map((s) => (<div key={s.id} className="card tile" onClick={() => onOpenSurface(s.id)}><div className="ti">{s.icon}</div><div className="tn">{s.name}</div><div className="td">{s.desc}</div></div>))}
        </div>
      </div>
    </>
  );
}
```

- [ ] **`apps/web/src/views/ProjectOverview.tsx`**
```tsx
import { useEffect, useState } from 'react';
import { api } from '../api';

type Run = { id: string; status: string; rowCount: number | null; startedAt: string; pipeline: string };
function rel(iso: string): string {
  const t = Date.parse(iso); if (Number.isNaN(t)) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`;
}

export function ProjectOverview({ projectName, onGo }: { projectName: string; onGo: (s: string) => void }) {
  const [c, setC] = useState({ datasets: 0, pipelines: 0, connectors: 0, apps: 0 });
  const [activity, setActivity] = useState<Run[]>([]);
  const [datasets, setDatasets] = useState<Array<{ id: string; name: string; rowCount?: number }>>([]);
  useEffect(() => {
    (async () => {
      const [d, p, cdb, ccl, caf, a] = await Promise.all([
        api.listDatasets().catch(() => ({ datasets: [] })), api.listPipelines().catch(() => ({ pipelines: [] })),
        api.listConnectorsDb().catch(() => ({ connectors: [] })), api.listConnectorsCloud().catch(() => ({ connectors: [] })),
        api.listConnectorsAirflow().catch(() => ({ connectors: [] })), api.listApps().catch(() => ({ apps: [] })),
      ]);
      setC({ datasets: d.datasets.length, pipelines: p.pipelines.length, connectors: cdb.connectors.length + ccl.connectors.length + caf.connectors.length, apps: a.apps.length });
      setDatasets(d.datasets.slice(0, 4));
      const runs = await Promise.all(p.pipelines.slice(0, 8).map((pl) => api.pipelineRuns(pl.id).then((r) => r.runs.map((run) => ({ ...run, pipeline: pl.name }))).catch(() => [])));
      setActivity((runs.flat() as Run[]).sort((x, y) => (x.startedAt < y.startedAt ? 1 : -1)).slice(0, 6));
    })().catch(() => {});
  }, []);
  const dc = (s: string) => (s === 'success' ? 'ok' : s === 'failed' ? 'bad' : 'run');
  const di = (s: string) => (s === 'success' ? '✓' : s === 'failed' ? '✗' : '▶');
  return (
    <>
      <div className="crumb">Console / {projectName}</div>
      <div className="hero"><div><h1 className="h1">{projectName}</h1><div className="sub" style={{ margin: 0 }}>Project workspace</div></div></div>
      <div className="grid k4">
        {([['datasets', 'Datasets', 'data'], ['pipelines', 'Pipelines', 'pipelines'], ['connectors', 'Connectors', 'connectors'], ['apps', 'Apps', 'apps']] as const).map(([key, label, go]) => (
          <div key={key} className="card kpi" style={{ cursor: 'pointer' }} onClick={() => onGo(go)}><div className="n">{c[key]}</div><div className="l">{label}</div></div>
        ))}
      </div>
      <div className="grid c2 sec">
        <div className="card"><div className="pad" style={{ paddingBottom: 2 }}><h3>Recent pipeline runs</h3></div>
          <div className="feed">
            {activity.length === 0 ? <div className="feeditem"><div className="t muted">No runs yet — create a pipeline to get started.</div></div> :
              activity.map((r) => (<div className="feeditem" key={r.id}><div className={`dot ${dc(r.status)}`}>{di(r.status)}</div><div className="t"><b>{r.pipeline}</b> {r.status}{r.rowCount != null ? ` · ${r.rowCount} rows` : ''}</div><div className="w">{rel(r.startedAt)}</div></div>))}
          </div>
        </div>
        <div><h3 style={{ margin: '0 0 12px', fontSize: 13.5, color: '#2b3550' }}>Recent datasets</h3>
          <div className="grid" style={{ gap: 12 }}>
            {datasets.length === 0 ? <div className="card pin"><div className="pd muted">No datasets yet.</div></div> :
              datasets.map((d) => (<div key={d.id} className="card pin" onClick={() => onGo('data')}><div className="pk">DATASET</div><div className="pt">{d.name}</div><div className="pd">{d.rowCount ?? 0} rows</div></div>))}
          </div>
          <div className="qa" style={{ marginTop: 14 }}><div className="chip" onClick={() => onGo('setup')}>＋ Upload &amp; model</div><div className="chip" onClick={() => onGo('pipelines')}>＋ Pipeline</div></div>
        </div>
      </div>
    </>
  );
}
```

---

## Task 3: Rebuild `apps/web/src/App.tsx`
```tsx
import { useEffect, useState } from 'react';
import { api, setActiveProject, type User } from './api';
import { LoginForm } from './components/LoginForm';
import { WorkspaceRail, colorFor } from './components/WorkspaceRail';
import { ContextSidebar, type SideItem } from './components/ContextSidebar';
import { TopBar } from './components/TopBar';
import { ConsoleHome } from './views/ConsoleHome';
import { ProjectOverview } from './views/ProjectOverview';
import { SetupView } from './views/SetupView';
import { ExplorerView } from './views/ExplorerView';
import { AdminView } from './views/AdminView';
import { DashboardsView } from './views/DashboardsView';
import { AskView } from './views/AskView';
import { AppsView } from './views/AppsView';
import { GovernanceView } from './views/GovernanceView';
import { DataView } from './views/DataView';
import { PipelinesView } from './views/PipelinesView';
import { ConnectorsView } from './views/ConnectorsView';
import { AutomationsView } from './views/AutomationsView';
import { LineageView } from './views/LineageView';
import { CatalogView } from './views/CatalogView';
import { ApiSdkView } from './views/ApiSdkView';

const PROJECT_ITEMS: SideItem[] = [
  { id: 'overview', label: 'Overview', icon: '▦' }, { id: 'data', label: 'Data', icon: '▤' }, { id: 'setup', label: 'Upload & model', icon: '↥' },
  { id: 'pipelines', label: 'Pipelines', icon: '⑂' }, { id: 'connectors', label: 'Connectors', icon: '⇄' }, { id: 'apps', label: 'Apps', icon: '▥' }, { id: 'automations', label: 'Automations', icon: '⚡' },
];
const CONSOLE_ITEMS: SideItem[] = [
  { id: 'home', label: 'Home', icon: '⌂' }, { id: 'ontology', label: 'Ontology Explorer', icon: '◎' }, { id: 'lineage', label: 'Lineage', icon: '⇲' },
  { id: 'catalog', label: 'Catalog', icon: '≣' }, { id: 'dashboards', label: 'Dashboards', icon: '▦' }, { id: 'governance', label: 'Governance', icon: '🛡' },
  { id: 'apisdk', label: 'API & SDK', icon: '{}' }, { id: 'ask', label: 'Ask', icon: '✦' }, { id: 'admin', label: 'Admin', icon: '⚙' },
];
const labelOf = (items: SideItem[], id: string): string => items.find((i) => i.id === id)?.label ?? id;

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loginErr, setLoginErr] = useState('');
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [project, setProject] = useState('project_default');
  const [area, setArea] = useState<'console' | 'project'>('project');
  const [view, setView] = useState('overview');
  const [rk, setRk] = useState(0);

  useEffect(() => { api.me().then((r) => setUser(r.user)).catch(() => setUser(null)); }, []);
  useEffect(() => { if (user) api.listProjects().then((r) => { setProjects(r.projects); const def = r.projects.find((p) => p.id === 'project_default') ?? r.projects[0]; if (def) { setProject(def.id); setActiveProject(def.id); } }).catch(() => {}); }, [user]);

  async function doLogin(email: string, password: string) { setLoginErr(''); try { await api.login(email, password); setUser((await api.me()).user); } catch (e) { setLoginErr((e as Error).message); } }
  async function doLogout() { await api.logout().catch(() => {}); setUser(null); }
  function openProject(id: string) { setActiveProject(id); setProject(id); setArea('project'); setView('overview'); setRk((k) => k + 1); }
  function openConsole() { setArea('console'); setView('home'); }
  function openSurface(id: string) { setArea('console'); setView(id); }
  async function newProject() { const n = window.prompt('New project name'); if (!n || !n.trim()) return; try { const { id } = await api.createProject(n.trim()); setProjects((await api.listProjects()).projects); openProject(id); } catch { /* ignore */ } }

  if (!user) return <div className="wrap"><LoginForm onSubmit={doLogin} error={loginErr} /></div>;

  const projName = projects.find((p) => p.id === project)?.name ?? 'Project';
  const k = `${project}:${rk}`;
  const breadcrumb = area === 'console' ? (view === 'home' ? ['Console'] : ['Console', labelOf(CONSOLE_ITEMS, view)]) : ['Console', projName, labelOf(PROJECT_ITEMS, view)];

  const surface = (() => {
    if (area === 'console') {
      switch (view) {
        case 'ontology': return <ExplorerView />;
        case 'lineage': return <LineageView />;
        case 'catalog': return <CatalogView />;
        case 'dashboards': return <DashboardsView />;
        case 'governance': return <GovernanceView />;
        case 'apisdk': return <ApiSdkView />;
        case 'ask': return <AskView />;
        case 'admin': return <AdminView />;
        default: return <ConsoleHome projects={projects} onOpenProject={openProject} onNewProject={newProject} onOpenSurface={openSurface} />;
      }
    }
    switch (view) {
      case 'data': return <DataView key={k} />;
      case 'setup': return <SetupView onModeled={() => { setRk((x) => x + 1); setView('data'); }} />;
      case 'pipelines': return <PipelinesView key={k} />;
      case 'connectors': return <ConnectorsView key={k} />;
      case 'apps': return <AppsView key={k} />;
      case 'automations': return <AutomationsView key={k} />;
      default: return <ProjectOverview key={k} projectName={projName} onGo={setView} />;
    }
  })();

  return (
    <div className="app">
      <WorkspaceRail projects={projects} activeProjectId={project} area={area} userInitial={(user.email[0] ?? 'U').toUpperCase()} onConsole={openConsole} onSelectProject={openProject} onNewProject={newProject} />
      {area === 'console'
        ? <ContextSidebar header={{ title: 'Console' }} items={CONSOLE_ITEMS} active={view} onSelect={(v) => (v === 'home' ? openConsole() : openSurface(v))} />
        : <ContextSidebar header={{ title: projName, subtitle: 'Project workspace', dotColor: colorFor(project) }} items={PROJECT_ITEMS} active={view} onSelect={setView} />}
      <div className="main">
        <TopBar breadcrumb={breadcrumb} userEmail={user.email} onSignOut={doLogout} />
        <div className="content">{surface}</div>
      </div>
    </div>
  );
}
```

- [ ] **Remove superseded:** `git rm apps/web/src/components/Sidebar.tsx apps/web/src/components/Sidebar.test.tsx apps/web/src/components/ProjectSwitcher.tsx apps/web/src/components/ProjectSwitcher.test.tsx` (grep first to confirm only `App.tsx` referenced them; it no longer does).

- [ ] **Verify:** `pnpm --filter @so/web typecheck` (0) — note: all imported views exist (SetupView, ExplorerView, AdminView, DashboardsView, AskView, AppsView, GovernanceView, DataView, PipelinesView, ConnectorsView, AutomationsView, LineageView, CatalogView, ApiSdkView); the `api` methods used by ProjectOverview (`listDatasets/listPipelines/listConnectorsDb/Cloud/Airflow/listApps/pipelineRuns`) all exist. `pnpm --filter @so/web test` (all pass). `pnpm --filter @so/web build` (succeeds). No unused imports; no `eslint-disable react-hooks/exhaustive-deps`.

- [ ] **Commit:** `git add -A && git commit -m "feat(web): hybrid UI — workspace rail + rich project home + slim top bar"`

---

## Task 4: Full verification + merge (GATED)
- [ ] `pnpm typecheck; pnpm lint`; then `pnpm test >/tmp/v.log 2>&1; t=$?; grep -E "Tests +[0-9]+ (passed|failed)" /tmp/v.log | tail -1`. **Only if tc/lint/`t` all 0**: `git checkout main && git merge --ff-only phase46/ui-hybrid`. (Flaky env: re-run on mass ~60000ms timeouts / `ERR_IPC_CHANNEL_CLOSED` with tests otherwise passing; ensure Docker up via `open -a Docker`.)

---

## Self-review
- **Hybrid delivered** — rail (project avatars + Console) + project sidebar + slim top bar (breadcrumb · search · sign-out) + rich project Home (hero · KPI cards · recent-runs feed · recent-datasets). ✓
- **Project-first** — opens in the default project's Overview; rail/sidebar/breadcrumb make context obvious. ✓
- **Shared on Console** — Console dashboard + console sidebar; never mixed into a project. ✓
- **Real data** — KPI counts + activity (aggregated pipeline runs) + recent datasets are live (project-scoped); switching project re-keys + refetches. ✓
- **Testable** — `WorkspaceRail` + `ContextSidebar` + `TopBar` jsdom-tested. ✓
- **Deferred (polish):** per-project stats on Console cards; pin feature; tidy lingering inline styles inside individual surface views; Explorer filtered to the project's datasets. Flagged.
