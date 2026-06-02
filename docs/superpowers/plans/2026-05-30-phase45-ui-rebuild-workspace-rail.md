# Phase 45 — UI Rebuild: Workspace Rail + Console/Project Contexts Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps `- [ ]`.

**Goal:** Replace the flat sidebar shell with the approved **Layout A** rebuild: a far-left **workspace rail** (logo · ⌂ Console · a project avatar per project · ＋ New · user), a **context sidebar** (project surfaces OR console surfaces), and content. The window opens **inside a project** by default; **shared assets live on the Console** (project cards + platform tiles). New design system (light content, dark rail/sidebar, cards/tiles/badges) ported from the approved mockups (`docs/mockups/base.css`).

**Architecture:** Pure `WorkspaceRail` + `ContextSidebar` (jsdom-tested) + `ConsoleHome` + `ProjectOverview` views; `App.tsx` rebuilt as a context router. All existing surface views are reused, rendered inside the new chrome. Supersedes `Sidebar`/`ProjectSwitcher` (removed).

---

## Pre-flight
- [ ] **Branch:** `git checkout main && git checkout -b phase45/ui-rebuild`

---

## Task 1: Design system — replace `apps/web/src/styles.css`

- [ ] **Step 1: Overwrite `apps/web/src/styles.css`** with the new design system (ports the mockup + base elements + the classes existing views use: `.card .err .sec .sel .ot .detail .k .v .row .wrap table input button select textarea`):
```css
:root{
  --bg:#f5f7fa;--panel:#fff;--ink:#10151f;--muted:#6b7488;--line:#e7eaf0;
  --rail:#0b1020;--side:#161d2e;--side-ink:#cdd4e4;--side-muted:#7e879c;
  --accent:#4763e4;--accent-soft:#eef1fe;--ok:#137a4b;--ok-bg:#e7f5ed;--warn:#9a5b00;--warn-bg:#fdf1e1;--bad:#b42318;--bad-bg:#fdeceb;
  --shadow:0 1px 2px rgba(16,21,31,.05),0 4px 16px rgba(16,21,31,.04);
}
*{box-sizing:border-box}
html,body,#root{margin:0;height:100%}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif;background:var(--bg);color:var(--ink);font-size:14px;-webkit-font-smoothing:antialiased}
h2{font-size:20px;font-weight:700;margin:0 0 12px}
h3{font-size:14px;font-weight:650;margin:0 0 10px;color:#384256}
a{color:var(--accent)}
label{font-size:12.5px;color:var(--muted);margin-right:6px}
input,select,textarea{font:inherit;border:1px solid var(--line);background:#fff;border-radius:8px;padding:7px 10px;color:var(--ink);margin:3px 6px 3px 0}
input:focus,select:focus,textarea:focus{outline:none;border-color:var(--accent)}
button{font:inherit;background:var(--accent);color:#fff;border:none;border-radius:8px;padding:8px 13px;font-weight:600;cursor:pointer}
button:hover{filter:brightness(1.05)}
button.sec{background:#fff;color:var(--ink);border:1px solid var(--line)}
.err{color:var(--bad);background:var(--bad-bg);border:1px solid #f6cdc9;padding:8px 12px;border-radius:8px;margin-top:10px;font-size:13px}
table{width:100%;border-collapse:collapse}
th{text-align:left;font-size:11.5px;letter-spacing:.04em;color:var(--muted);text-transform:uppercase;padding:9px 10px;border-bottom:1px solid var(--line)}
td{padding:10px;border-bottom:1px solid #f0f2f6;font-size:13.5px}
tr.sel td,tr.sel{background:var(--accent-soft)}
/* layout */
.app{display:flex;height:100vh;overflow:hidden}
.rail{width:64px;background:var(--rail);display:flex;flex-direction:column;align-items:center;padding:14px 0;gap:9px;flex-shrink:0}
.rail .logo{width:34px;height:34px;border-radius:9px;background:linear-gradient(135deg,#5a7bff,#3145c9);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;margin-bottom:6px}
.rail .ico{width:40px;height:40px;border-radius:11px;display:flex;align-items:center;justify-content:center;color:#aeb6cc;cursor:pointer;font-size:17px;border:none;background:transparent}
.rail .ico:hover{background:#1b2236;color:#fff}
.rail .ico.active{background:#fff;color:var(--accent)}
.rail .av{width:38px;height:38px;border-radius:11px;display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff;cursor:pointer;font-size:13px;outline:2px solid transparent;border:none}
.rail .av.active{outline:2px solid #fff}
.rail .sep{width:28px;height:1px;background:#26304a;margin:2px 0}
.rail .spacer{flex:1}
.side{width:236px;background:var(--side);color:var(--side-ink);display:flex;flex-direction:column;flex-shrink:0;padding:16px 0;overflow-y:auto}
.side .phead{padding:2px 18px 14px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #232c43;margin-bottom:8px}
.side .pdot{width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff;font-size:13px;flex-shrink:0}
.side .pname{font-weight:650;color:#fff;font-size:15px;line-height:1.15}
.side .psub{font-size:11px;color:var(--side-muted)}
.side .glabel{font-size:10.5px;letter-spacing:.09em;color:var(--side-muted);padding:12px 18px 5px;text-transform:uppercase}
.side .item{padding:8px 18px;color:var(--side-ink);cursor:pointer;display:flex;align-items:center;gap:10px;font-size:13.5px;border-left:2px solid transparent}
.side .item:hover{background:#1d2640}
.side .item.active{background:#222c49;color:#fff;border-left:2px solid var(--accent)}
.side .item .i{width:16px;text-align:center;opacity:.85}
.main{flex:1;display:flex;flex-direction:column;min-width:0}
.content{flex:1;overflow:auto;padding:26px 30px;background:var(--bg)}
.crumb{font-size:12.5px;color:var(--muted);margin-bottom:6px}
.h1{font-size:22px;font-weight:700;margin:0 0 2px}
.sub{color:var(--muted);margin:0 0 20px}
.grid{display:grid;gap:16px}
.stats{grid-template-columns:repeat(4,1fr)}
.card{background:var(--panel);border:1px solid var(--line);border-radius:13px;box-shadow:var(--shadow);padding:18px}
.stat .n{font-size:26px;font-weight:750;letter-spacing:-.02em}
.stat .l{color:var(--muted);font-size:12.5px;margin-top:2px}
.section{margin-top:26px}
.badge{display:inline-block;padding:3px 9px;border-radius:20px;font-size:11.5px;font-weight:600}
.badge.ok,.badge.success{background:var(--ok-bg);color:var(--ok)}
.badge.run,.badge.running{background:var(--warn-bg);color:var(--warn)}
.badge.bad,.badge.failed{background:var(--bad-bg);color:var(--bad)}
.tiles{grid-template-columns:repeat(4,1fr)}
.tile{cursor:pointer;transition:.12s;display:flex;flex-direction:column;gap:8px}
.tile:hover{border-color:#c7d0ea;box-shadow:0 6px 22px rgba(71,99,228,.10);transform:translateY(-1px)}
.tile .ti{width:40px;height:40px;border-radius:11px;background:var(--accent-soft);color:var(--accent);display:flex;align-items:center;justify-content:center;font-size:19px}
.tile .tn{font-weight:650}
.tile .td{color:var(--muted);font-size:12.5px;line-height:1.35}
.pcards{grid-template-columns:repeat(3,1fr)}
.pcard{cursor:pointer}
.pcard:hover{border-color:#c7d0ea;box-shadow:0 6px 22px rgba(16,21,31,.07)}
.pcard .ph{display:flex;align-items:center;gap:11px;margin-bottom:12px}
.pcard .pn{font-weight:700;font-size:15px}
.qa{display:flex;gap:10px;flex-wrap:wrap}
.chip{border:1px solid var(--line);background:#fff;border-radius:8px;padding:8px 12px;font-weight:600;color:#2a3550;cursor:pointer}
.chip:hover{border-color:var(--accent);color:var(--accent)}
.wrap{max-width:420px;margin:8vh auto}
/* explorer legacy */
.ot{display:flex;gap:24px}.detail{margin-top:8px}
.k{color:var(--muted);font-size:12px}.v{font-weight:600}
.row{display:flex;gap:10px;align-items:center}
ul.plain{list-style:none;padding:0;margin:0}
```

---

## Task 2: Pure components (+ tests)

**Files:** Create `apps/web/src/components/WorkspaceRail.tsx` (+ `.test.tsx`), `apps/web/src/components/ContextSidebar.tsx` (+ `.test.tsx`)

- [ ] **Step 1: `WorkspaceRail.tsx`**
```tsx
const COLORS = ['#4763e4', '#137a4b', '#9a5b00', '#a23b72', '#0e7490', '#6b7280', '#b4530a', '#5b21b6'];
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
        <button key={p.id} className={`av ${area === 'project' && p.id === activeProjectId ? 'active' : ''}`} style={{ background: colorFor(p.id) }} title={p.name} aria-label={`project ${p.name}`} onClick={() => onSelectProject(p.id)}>
          {p.name.slice(0, 1).toUpperCase()}
        </button>
      ))}
      <button className="ico" title="New project" aria-label="New project" onClick={onNewProject}>＋</button>
      <div className="spacer" />
      <div className="av" style={{ background: '#33405e' }}>{userInitial}</div>
    </div>
  );
}
```

- [ ] **Step 2: `WorkspaceRail.test.tsx`**
```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { WorkspaceRail } from './WorkspaceRail';

const projects = [{ id: 'project_default', name: 'Default' }, { id: 'p2', name: 'Marketing' }];
describe('WorkspaceRail', () => {
  it('renders project avatars + console, fires callbacks', () => {
    const onConsole = vi.fn(); const onSelectProject = vi.fn(); const onNewProject = vi.fn();
    render(<WorkspaceRail projects={projects} activeProjectId="p2" area="project" userInitial="A" onConsole={onConsole} onSelectProject={onSelectProject} onNewProject={onNewProject} />);
    fireEvent.click(screen.getByLabelText('Console')); expect(onConsole).toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('project Marketing')); expect(onSelectProject).toHaveBeenCalledWith('p2');
    fireEvent.click(screen.getByLabelText('New project')); expect(onNewProject).toHaveBeenCalled();
    expect(screen.getByLabelText('project Marketing').className).toContain('active');
  });
});
```

- [ ] **Step 3: `ContextSidebar.tsx`**
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
        <div key={it.id} className={`item ${active === it.id ? 'active' : ''}`} onClick={() => onSelect(it.id)}>
          {it.icon ? <span className="i">{it.icon}</span> : null}{it.label}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: `ContextSidebar.test.tsx`**
```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ContextSidebar } from './ContextSidebar';

describe('ContextSidebar', () => {
  it('renders header + items, selects on click', () => {
    const onSelect = vi.fn();
    render(<ContextSidebar header={{ title: 'Marketing', subtitle: 'Project workspace', dotColor: '#4763e4' }} items={[{ id: 'overview', label: 'Overview' }, { id: 'data', label: 'Data' }]} active="overview" onSelect={onSelect} />);
    expect(screen.getByText('Marketing')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Data')); expect(onSelect).toHaveBeenCalledWith('data');
    expect(screen.getByText('Overview').className).toContain('active');
  });
});
```

- [ ] **Step 5: Run → PASS:** `pnpm --filter @so/web test -- WorkspaceRail ContextSidebar` (timeout 120000).

---

## Task 3: Console + Project Overview views

**Files:** Create `apps/web/src/views/ConsoleHome.tsx`, `apps/web/src/views/ProjectOverview.tsx`

- [ ] **Step 1: `ConsoleHome.tsx`**
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
  projects: Array<{ id: string; name: string }>;
  onOpenProject: (id: string) => void; onNewProject: () => void; onOpenSurface: (id: string) => void;
}) {
  return (
    <div className="content">
      <h1 className="h1">Console</h1>
      <p className="sub">Shared platform assets &amp; all projects</p>
      <div className="section"><h3>Projects</h3>
        <div className="grid pcards">
          {projects.map((p) => (
            <div key={p.id} className="card pcard" onClick={() => onOpenProject(p.id)}>
              <div className="ph"><div className="pdot" style={{ background: colorFor(p.id) }}>{p.name.slice(0, 1).toUpperCase()}</div><div className="pn">{p.name}</div></div>
              <div className="sub" style={{ margin: 0, fontSize: 13 }}>Open workspace →</div>
            </div>
          ))}
          <div className="card pcard" style={{ borderStyle: 'dashed', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontWeight: 600 }} onClick={onNewProject}>＋ New project</div>
        </div>
      </div>
      <div className="section"><h3>Shared · Platform</h3>
        <div className="grid tiles">
          {SHARED.map((s) => (
            <div key={s.id} className="card tile" onClick={() => onOpenSurface(s.id)}>
              <div className="ti">{s.icon}</div><div className="tn">{s.name}</div><div className="td">{s.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `ProjectOverview.tsx`**
```tsx
import { useEffect, useState } from 'react';
import { api } from '../api';

export function ProjectOverview({ projectName, onGo }: { projectName: string; onGo: (surface: string) => void }) {
  const [counts, setCounts] = useState<{ datasets: number; pipelines: number; connectors: number; apps: number }>({ datasets: 0, pipelines: 0, connectors: 0, apps: 0 });
  useEffect(() => {
    (async () => {
      const [d, p, cdb, ccl, caf, a] = await Promise.all([
        api.listDatasets().catch(() => ({ datasets: [] })),
        api.listPipelines().catch(() => ({ pipelines: [] })),
        api.listConnectorsDb().catch(() => ({ connectors: [] })),
        api.listConnectorsCloud().catch(() => ({ connectors: [] })),
        api.listConnectorsAirflow().catch(() => ({ connectors: [] })),
        api.listApps().catch(() => ({ apps: [] })),
      ]);
      setCounts({ datasets: d.datasets.length, pipelines: p.pipelines.length, connectors: cdb.connectors.length + ccl.connectors.length + caf.connectors.length, apps: a.apps.length });
    })().catch(() => {});
  }, []);
  return (
    <div className="content">
      <div className="crumb">Console / {projectName}</div>
      <h1 className="h1">Overview</h1>
      <p className="sub">{projectName} · project workspace</p>
      <div className="grid stats">
        <div className="card stat"><div className="n">{counts.datasets}</div><div className="l">Datasets</div></div>
        <div className="card stat"><div className="n">{counts.pipelines}</div><div className="l">Pipelines</div></div>
        <div className="card stat"><div className="n">{counts.connectors}</div><div className="l">Connectors</div></div>
        <div className="card stat"><div className="n">{counts.apps}</div><div className="l">Apps</div></div>
      </div>
      <div className="section"><h3>Quick actions</h3>
        <div className="qa">
          <div className="chip" onClick={() => onGo('setup')}>＋ Upload &amp; model</div>
          <div className="chip" onClick={() => onGo('pipelines')}>＋ New pipeline</div>
          <div className="chip" onClick={() => onGo('connectors')}>＋ Connector</div>
          <div className="chip" onClick={() => onGo('apps')}>＋ App</div>
        </div>
      </div>
    </div>
  );
}
```

---

## Task 4: Rebuild `apps/web/src/App.tsx` (context router)

- [ ] **Step 1: Overwrite `App.tsx`**
```tsx
import { useEffect, useState } from 'react';
import { api, setActiveProject, type User } from './api';
import { LoginForm } from './components/LoginForm';
import { WorkspaceRail, colorFor } from './components/WorkspaceRail';
import { ContextSidebar, type SideItem } from './components/ContextSidebar';
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

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loginErr, setLoginErr] = useState('');
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [project, setProject] = useState('project_default');
  const [area, setArea] = useState<'console' | 'project'>('project');
  const [view, setView] = useState('overview');
  const [rk, setRk] = useState(0);

  useEffect(() => { api.me().then((r) => setUser(r.user)).catch(() => setUser(null)); }, []);
  useEffect(() => { if (user) api.listProjects().then((r) => { setProjects(r.projects); if (r.projects[0]) { const def = r.projects.find((p) => p.id === 'project_default') ?? r.projects[0]!; setProject(def.id); setActiveProject(def.id); } }).catch(() => {}); }, [user]);

  async function doLogin(email: string, password: string) { setLoginErr(''); try { await api.login(email, password); setUser((await api.me()).user); } catch (e) { setLoginErr((e as Error).message); } }
  async function doLogout() { await api.logout().catch(() => {}); setUser(null); }
  function openProject(id: string) { setActiveProject(id); setProject(id); setArea('project'); setView('overview'); setRk((k) => k + 1); }
  function openConsole() { setArea('console'); setView('home'); }
  function openSurface(id: string) { setArea('console'); setView(id); }
  async function newProject() { const n = window.prompt('New project name'); if (!n || !n.trim()) return; try { const { id } = await api.createProject(n.trim()); setProjects((await api.listProjects()).projects); openProject(id); } catch { /* ignore */ } }

  if (!user) return <div className="wrap"><LoginForm onSubmit={doLogin} error={loginErr} /></div>;

  const projName = projects.find((p) => p.id === project)?.name ?? 'Project';
  const k = `${project}:${rk}`;
  const surface = (() => {
    if (area === 'console') {
      switch (view) {
        case 'home': return <ConsoleHome projects={projects} onOpenProject={openProject} onNewProject={newProject} onOpenSurface={openSurface} />;
        case 'ontology': return <div className="content"><ExplorerView /></div>;
        case 'lineage': return <div className="content"><LineageView /></div>;
        case 'catalog': return <div className="content"><CatalogView /></div>;
        case 'dashboards': return <div className="content"><DashboardsView /></div>;
        case 'governance': return <div className="content"><GovernanceView /></div>;
        case 'apisdk': return <div className="content"><ApiSdkView /></div>;
        case 'ask': return <div className="content"><AskView /></div>;
        case 'admin': return <div className="content"><AdminView /></div>;
        default: return <ConsoleHome projects={projects} onOpenProject={openProject} onNewProject={newProject} onOpenSurface={openSurface} />;
      }
    }
    switch (view) {
      case 'overview': return <ProjectOverview key={k} projectName={projName} onGo={setView} />;
      case 'data': return <div className="content" key={k}><DataView /></div>;
      case 'setup': return <div className="content"><SetupView onModeled={() => { setRk((x) => x + 1); setView('data'); }} /></div>;
      case 'pipelines': return <div className="content" key={k}><PipelinesView /></div>;
      case 'connectors': return <div className="content" key={k}><ConnectorsView /></div>;
      case 'apps': return <div className="content" key={k}><AppsView /></div>;
      case 'automations': return <div className="content" key={k}><AutomationsView /></div>;
      default: return <ProjectOverview key={k} projectName={projName} onGo={setView} />;
    }
  })();

  return (
    <div className="app">
      <WorkspaceRail projects={projects} activeProjectId={project} area={area} userInitial={(user.email[0] ?? 'U').toUpperCase()} onConsole={openConsole} onSelectProject={openProject} onNewProject={newProject} />
      {area === 'console'
        ? <ContextSidebar header={{ title: 'Console' }} items={CONSOLE_ITEMS} active={view} onSelect={(v) => (v === 'home' ? openConsole() : openSurface(v))} />
        : <ContextSidebar header={{ title: projName, subtitle: 'Project workspace', dotColor: colorFor(project) }} items={PROJECT_ITEMS} active={view} onSelect={setView} />}
      <div className="main">{surface}</div>
      <button className="sec" style={{ position: 'fixed', top: 10, right: 14, zIndex: 5 }} onClick={doLogout}>Sign out</button>
    </div>
  );
}
```
(NOTE: the surface views already render their own `.card`; wrapping in `<div className="content">` gives them the padded scroll area. `ConsoleHome`/`ProjectOverview` include their own `.content` wrapper, so don't double-wrap them.)

- [ ] **Step 2: Remove superseded components** — `git rm apps/web/src/components/Sidebar.tsx apps/web/src/components/Sidebar.test.tsx apps/web/src/components/ProjectSwitcher.tsx apps/web/src/components/ProjectSwitcher.test.tsx`. Grep to confirm nothing else imports them; if `DataView`/others imported `Sidebar`, they didn't — only `App.tsx` did.

- [ ] **Step 3: Verify the web package:** `pnpm --filter @so/web typecheck` (0); `pnpm --filter @so/web test` (all pass incl. WorkspaceRail + ContextSidebar; the removed Sidebar/ProjectSwitcher tests are gone); `pnpm --filter @so/web build` (succeeds). (timeout 180000). No unused imports; no `eslint-disable react-hooks/exhaustive-deps`.

- [ ] **Step 4: Commit:** `git add -A && git commit -m "feat(web): UI rebuild — workspace rail + Console/Project contexts (Layout A)"`

---

## Task 5: Full verification + merge (GATED)
- [ ] `pnpm typecheck; pnpm lint`; then `pnpm test >/tmp/v.log 2>&1; t=$?; grep -E "Tests +[0-9]+ (passed|failed)" /tmp/v.log | tail -1`. **Only if tc/lint/`t` all 0**: `git checkout main && git merge --ff-only phase45/ui-rebuild`. (Flaky env: re-run on mass ~60000ms timeouts / `ERR_IPC_CHANNEL_CLOSED` with tests otherwise passing; ensure Docker up via `open -a Docker`.)

---

## Self-review
- **Real revamp, not a wrap** — new design system (light content, dark rail/sidebar, cards/tiles/badges) + a two-context router (workspace rail switches Console↔project). ✓
- **Project-first** — opens inside the default project (`area:'project'`, `view:'overview'`); the rail/sidebar make the project context obvious. ✓
- **Shared on Console** — Console dashboard (project cards + platform tiles) + a console sidebar to reach Ontology/Lineage/Catalog/Dashboards/Governance/API&SDK/Ask/Admin; never mixed into a project. ✓
- **Project switch refetches** — project-scoped surfaces keyed by `project:rk`. ✓
- **Testable** — pure `WorkspaceRail` + `ContextSidebar` jsdom-tested. ✓
- **Deferred (polish):** per-project live stats on Console cards; recent-runs on Overview (needs a cross-pipeline endpoint); tidy any remaining dark inline styles inside individual surface views; Explorer filtered to the active project's datasets. Flagged.
