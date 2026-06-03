export function RolesTable({ roles }: { roles: Array<{ id: string; name: string; permissions: string[] }> }) {
  if (roles.length === 0) return <p style={{ color: 'var(--muted)' }}>No roles.</p>;
  return (
    <table>
      <thead><tr><th>Role</th><th>Permissions</th></tr></thead>
      <tbody>
        {roles.map((r) => (
          <tr key={r.id}>
            <td><b>{r.name}</b></td>
            <td>
              {r.permissions.length === 0
                ? <span className="muted">none</span>
                : r.permissions.map((p) => <span key={p} className="badge run" style={{ marginRight: 5 }}>{p}</span>)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
