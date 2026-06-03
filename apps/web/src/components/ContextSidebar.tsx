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
