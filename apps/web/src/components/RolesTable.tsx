export function RolesTable({ roles, onDelete }: { roles: Array<{ id: string; name: string; permissions: string[] }>; onDelete?: (id: string) => void }) {
  if (roles.length === 0) return <p style={{ color: 'var(--muted)' }}>No roles.</p>;
  return (
    <table>
      <thead><tr><th>Role</th><th>Permissions</th>{onDelete ? <th /> : null}</tr></thead>
      <tbody>
        {roles.map((r) => (
          <tr key={r.id}>
            <td><b>{r.name}</b></td>
            <td>
              {r.permissions.length === 0
                ? <span className="muted">none</span>
                : r.permissions.map((p) => <span key={p} className="badge run" style={{ marginRight: 5 }}>{p}</span>)}
            </td>
            {onDelete ? (
              <td>{r.permissions.includes('*') ? null : <button className="sec" onClick={() => onDelete(r.id)}>Delete</button>}</td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
