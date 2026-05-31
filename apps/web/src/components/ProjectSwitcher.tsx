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
