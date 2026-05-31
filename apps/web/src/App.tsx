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
import { PipelinesView } from './views/PipelinesView';
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
      case 'pipelines': return <PipelinesView key={refreshKey} />;
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
