import { useEffect, useState } from 'react';
import { api, type User } from './api';
import { LoginForm } from './components/LoginForm';
import { SetupView } from './views/SetupView';
import { ExplorerView } from './views/ExplorerView';
import { AdminView } from './views/AdminView';
import { DashboardsView } from './views/DashboardsView';
import { AskView } from './views/AskView';

type View = 'setup' | 'explorer' | 'admin' | 'dashboards' | 'ask';

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loginErr, setLoginErr] = useState('');
  const [view, setView] = useState<View>('explorer');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => { api.me().then((r) => setUser(r.user)).catch(() => setUser(null)); }, []);

  async function doLogin(email: string, password: string) {
    setLoginErr('');
    try { await api.login(email, password); setUser((await api.me()).user); }
    catch (e) { setLoginErr((e as Error).message); }
  }
  async function doLogout() { await api.logout().catch(() => {}); setUser(null); }

  if (!user) return <div className="wrap"><LoginForm onSubmit={doLogin} error={loginErr} /></div>;

  return (
    <>
      <div className="nav"><b>&#9651; SoftwareOntology</b><span>{user.email}</span><button className="sec" onClick={doLogout}>Sign out</button></div>
      <div className="tabs">
        <div className={`tab ${view === 'explorer' ? 'active' : ''}`} onClick={() => setView('explorer')}>Explorer</div>
        <div className={`tab ${view === 'setup' ? 'active' : ''}`} onClick={() => setView('setup')}>Upload &amp; model</div>
        <div className={`tab ${view === 'admin' ? 'active' : ''}`} onClick={() => setView('admin')}>Admin</div>
        <div className={`tab ${view === 'dashboards' ? 'active' : ''}`} onClick={() => setView('dashboards')}>Dashboards</div>
        <div className={`tab ${view === 'ask' ? 'active' : ''}`} onClick={() => setView('ask')}>Ask</div>
      </div>
      <div className="wrap">
        {view === 'setup' ? <SetupView onModeled={() => { setRefreshKey((k) => k + 1); setView('explorer'); }} />
          : view === 'admin' ? <AdminView />
          : view === 'dashboards' ? <DashboardsView />
          : view === 'ask' ? <AskView />
          : <ExplorerView key={refreshKey} />}
      </div>
    </>
  );
}
