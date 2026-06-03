export function TopBar({ breadcrumb, userEmail, onSignOut, onSearch }: { breadcrumb: string[]; userEmail: string; onSignOut: () => void; onSearch?: (q: string) => void }) {
  return (
    <div className="topbar2">
      <div className="crumb2">
        {breadcrumb.map((b, i) => (
          <span key={i}>{i > 0 ? <span className="sepc">/</span> : null}<span className={i === breadcrumb.length - 1 ? 'cur' : ''}>{b}</span></span>
        ))}
      </div>
      <div className="spacer" />
      <input className="search2" placeholder="Search…" aria-label="search" onKeyDown={(e) => { if (e.key === 'Enter' && onSearch) onSearch((e.target as HTMLInputElement).value); }} />
      <span className="muted" style={{ fontSize: 13 }}>{userEmail}</span>
      <button className="sec" onClick={onSignOut}>Sign out</button>
    </div>
  );
}
