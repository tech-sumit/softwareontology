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
export function ConsoleHome({ projects, archivedProjects, onOpenProject, onNewProject, onOpenSurface, onRestoreProject }: {
  projects: Array<{ id: string; name: string; description?: string }>; archivedProjects: Array<{ id: string; name: string; description?: string }>; onOpenProject: (id: string) => void; onNewProject: () => void; onOpenSurface: (id: string) => void; onRestoreProject: (id: string) => void;
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
              {p.description ? <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>{p.description}</div> : null}
              <div className="sub" style={{ margin: 0, fontSize: 13 }}>Open workspace →</div>
            </div>
          ))}
          <div className="card pcard" style={{ borderStyle: 'dashed', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--faint)', fontWeight: 600 }} onClick={onNewProject}>＋ New project</div>
        </div>
      </div>
      {archivedProjects.length > 0 ? (
        <div className="sec"><h3>Archived</h3>
          <div className="grid pcards">
            {archivedProjects.map((p) => (
              <div key={p.id} className="card pcard" style={{ opacity: 0.65 }}>
                <div className="ph"><div className="pdot" style={{ background: colorFor(p.id) }}>{p.name.slice(0, 1).toUpperCase()}</div><div className="pn">{p.name}</div></div>
                <button className="sec" style={{ marginTop: 6 }} onClick={() => onRestoreProject(p.id)}>Restore</button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <div className="sec"><h3>Shared · Platform</h3>
        <div className="grid tiles">
          {SHARED.map((s) => (<div key={s.id} className="card tile" onClick={() => onOpenSurface(s.id)}><div className="ti">{s.icon}</div><div className="tn">{s.name}</div><div className="td">{s.desc}</div></div>))}
        </div>
      </div>
    </>
  );
}
