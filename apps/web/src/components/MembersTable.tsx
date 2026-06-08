export type MemberRow = { userId: string; email: string; role: 'owner' | 'editor' | 'viewer' };
export function MembersTable({ members, canManage, onChangeRole, onRemove }: {
  members: MemberRow[]; canManage: boolean; onChangeRole: (userId: string, role: string) => void; onRemove: (userId: string) => void;
}) {
  return (
    <table>
      <thead><tr><th>Member</th><th>Role</th>{canManage ? <th /> : null}</tr></thead>
      <tbody>
        {members.map((m) => (
          <tr key={m.userId}>
            <td>{m.email}</td>
            <td>{canManage
              ? <select aria-label={`role for ${m.email}`} value={m.role} onChange={(e) => onChangeRole(m.userId, e.target.value)}>{(['owner', 'editor', 'viewer'] as const).map((r) => <option key={r} value={r}>{r}</option>)}</select>
              : m.role}</td>
            {canManage ? <td><button className="sec" onClick={() => onRemove(m.userId)}>Remove</button></td> : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
