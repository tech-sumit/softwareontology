export function UsersTable({ users }: { users: Array<{ id: string; email: string; roles: string[] }> }) {
  if (users.length === 0) return <p style={{ color: 'var(--muted)' }}>No users.</p>;
  return (
    <table>
      <thead><tr><th>Email</th><th>Roles</th></tr></thead>
      <tbody>
        {users.map((u) => (
          <tr key={u.id}><td>{u.email}</td><td>{u.roles.join(', ') || '—'}</td></tr>
        ))}
      </tbody>
    </table>
  );
}
