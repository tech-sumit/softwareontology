import { useEffect, useState } from 'react';
import { api, setActiveProject, type User } from './api';
import { LoginForm } from './components/LoginForm';
import { CreateProjectModal } from './components/CreateProjectModal';
import { WorkspaceRail, colorFor } from './components/WorkspaceRail';
import { ContextSidebar, type SideItem } from './components/ContextSidebar';
import { TopBar } from './components/TopBar';
import { ConsoleHome } from './views/ConsoleHome';
import { ProjectOverview } from './views/ProjectOverview';
import { SetupView } from './views/SetupView';
import { OntologyManager } from './views/OntologyManager';
import { ObjectExplorer } from './views/ObjectExplorer';
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
  { id: 'home', label: 'Home', icon: '⌂' }, { id: 'ontology', label: 'Ontology Explorer', icon: '◎' }, { id: 'explorer', label: 'Object Explorer', icon: '◧' }, { id: 'lineage', label: 'Lineage', icon: '⇲' },
  { id: 'catalog', label: 'Catalog', icon: '≣' }, { id: 'dashboards', label: 'Dashboards', icon: '▦' }, { id: 'governance', label: 'Governance', icon: '🛡' },
  { id: 'apisdk', label: 'API & SDK', icon: '{}' }, { id: 'ask', label: 'Ask', icon: '✦' }, { id: 'admin', label: 'Admin', icon: '⚙' },
];
const labelOf = (items: SideItem[], id: string): string => items.find((i) => i.id === id)?.label ?? id;

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loginErr, setLoginErr] = useState('');
  const [projects, setProjects] = useState<Array<{ id: string; name: string; description?: string }>>([]);
  const [project, setProject] = useState('project_default');
  const [showCreate, setShowCreate] = useState(false);
  const [area, setArea] = useState<'console' | 'project'>('project');
  const [view, setView] = useState('overview');
  const [rk, setRk] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => { api.me().then((r) => setUser(r.user)).catch(() => setUser(null)); }, []);
  useEffect(() => { if (user) api.listProjects().then((r) => { setProjects(r.projects); const def = r.projects.find((p) => p.id === 'project_default') ?? r.projects[0]; if (def) { setProject(def.id); setActiveProject(def.id); } }).catch(() => {}); }, [user]);

  async function doLogin(email: string, password: string) { setLoginErr(''); try { await api.login(email, password); setUser((await api.me()).user); } catch (e) { setLoginErr((e as Error).message); } }
  async function doLogout() { await api.logout().catch(() => {}); setUser(null); }
  function openProject(id: string) { setActiveProject(id); setProject(id); setArea('project'); setView('overview'); setRk((k) => k + 1); }
  function openConsole() { setArea('console'); setView('home'); }
  function openSurface(id: string) { setArea('console'); setView(id); }
  function newProject() { setShowCreate(true); }

  if (!user) return <div className="wrap"><LoginForm onSubmit={doLogin} error={loginErr} onSso={() => { window.location.href = '/api/auth/oidc/login'; }} /></div>;

  const projName = projects.find((p) => p.id === project)?.name ?? 'Project';
  const k = `${project}:${rk}`;
  const breadcrumb = area === 'console' ? (view === 'home' ? ['Console'] : ['Console', labelOf(CONSOLE_ITEMS, view)]) : ['Console', projName, labelOf(PROJECT_ITEMS, view)];

  const surface = (() => {
    if (area === 'console') {
      switch (view) {
        case 'ontology': return <OntologyManager />;
        case 'explorer': return <ObjectExplorer />;
        case 'lineage': return <LineageView />;
        case 'catalog': return <CatalogView initialQuery={searchQuery} key={searchQuery} />;
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
        <TopBar breadcrumb={breadcrumb} userEmail={user.email} onSignOut={doLogout} onSearch={(q) => { setArea('console'); setView('catalog'); setSearchQuery(q); }} />
        <div className="content">{surface}</div>
      </div>
      {showCreate ? <CreateProjectModal onClose={() => setShowCreate(false)} onCreate={async (name, description) => { try { const { id } = await api.createProject(name, description); setProjects((await api.listProjects()).projects); setShowCreate(false); openProject(id); } catch { setShowCreate(false); } }} /> : null}
    </div>
  );
}
