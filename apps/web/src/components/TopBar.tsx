export function TopBar({ breadcrumb, userEmail, onSignOut, onSearch, branch, branches, onBranchChange }: { breadcrumb: string[]; userEmail: string; onSignOut: () => void; onSearch?: (q: string) => void; branch?: string; branches?: Array<{ name: string; status: string }>; onBranchChange?: (b: string) => void }) {
  return (
    <div className="topbar2">
      <div className="crumb2">
        {breadcrumb.map((b, i) => (
          <span key={i}>{i > 0 ? <span className="sepc">/</span> : null}<span className={i === breadcrumb.length - 1 ? 'cur' : ''}>{b}</span></span>
        ))}
      </div>
      <div className="spacer" />
      {branches && onBranchChange ? (
        <select aria-label="branch" className="branchsel" value={branch ?? 'main'} onChange={(e) => onBranchChange(e.target.value)} title="Active branch">
          {branches.map((b) => <option key={b.name} value={b.name}>⎇ {b.name}</option>)}
        </select>
      ) : null}
      <input className="search2" placeholder="Search…" aria-label="search" onKeyDown={(e) => { if (e.key === 'Enter' && onSearch) onSearch((e.target as HTMLInputElement).value); }} />
      <span className="muted" style={{ fontSize: 13 }}>{userEmail}</span>
      <button className="sec" onClick={onSignOut}>Sign out</button>
    </div>
  );
}
