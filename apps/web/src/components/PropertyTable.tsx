export interface Prop { apiName: string; column?: string; type: string; requiredPermission?: string | null }

export function PropertyTable({ properties, onSecure }: { properties: Prop[]; onSecure?: (p: string, perm: string | null) => void }) {
  if (properties.length === 0) return <p style={{ color: 'var(--muted)' }}>No properties.</p>;
  return (
    <table>
      <thead><tr><th>Property</th><th>Column</th><th>Type</th><th>Security</th></tr></thead>
      <tbody>
        {properties.map((p) => (
          <tr key={p.apiName}>
            <td><b>{p.apiName}</b></td><td className="muted">{p.column ?? '—'}</td><td>{p.type}</td>
            <td>{p.requiredPermission ? <span className="badge bad">requires {p.requiredPermission}</span> : <span className="muted">public</span>}
              {onSecure ? <button className="sec" style={{ marginLeft: 8 }} onClick={() => { const v = window.prompt(`Required permission for "${p.apiName}" (blank = public)`, p.requiredPermission ?? ''); if (v !== null) onSecure(p.apiName, v.trim() || null); }}>Secure</button> : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
