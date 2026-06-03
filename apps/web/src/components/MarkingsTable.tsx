export function MarkingsTable({ markings, clearedIds }: { markings: Array<{ id: string; name: string }>; clearedIds: Set<string> }) {
  if (markings.length === 0) return <p style={{ color: 'var(--muted)' }}>No markings yet.</p>;
  return (
    <table>
      <thead><tr><th>Marking</th><th>Your clearance</th></tr></thead>
      <tbody>
        {markings.map((m) => (
          <tr key={m.id}><td>{m.name}</td><td>{clearedIds.has(m.id) ? '✓ cleared' : '— not cleared'}</td></tr>
        ))}
      </tbody>
    </table>
  );
}
