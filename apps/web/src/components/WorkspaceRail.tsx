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
