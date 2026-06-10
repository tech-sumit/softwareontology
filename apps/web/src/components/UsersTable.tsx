export function UsersTable({ users, onDelete, currentEmail }: { users: Array<{ id: string; email: string; roles: string[] }>; onDelete?: (id: string) => void; currentEmail?: string }) {
  if (users.length === 0) return <p style={{ color: 'var(--muted)' }}>No users.</p>;
  return (
    <table>
      <thead><tr><th>Email</th><th>Roles</th>{onDelete ? <th /> : null}</tr></thead>
      <tbody>
        {users.map((u) => (
          <tr key={u.id}>
            <td>{u.email}</td>
            <td>{u.roles.join(', ') || '—'}</td>
            {onDelete ? (
              <td>{u.email === currentEmail ? null : <button className="sec" onClick={() => onDelete(u.id)}>Delete</button>}</td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
