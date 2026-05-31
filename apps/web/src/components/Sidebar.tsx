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
