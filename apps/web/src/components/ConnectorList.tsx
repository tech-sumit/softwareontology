export function ConnectorList({ connectors, onSync, onDelete }: { connectors: Array<{ id: string; name: string }>; onSync: (id: string) => void; onDelete?: (id: string) => void }) {
  if (connectors.length === 0) return <p style={{ color: 'var(--muted)' }}>None yet.</p>;
  return (
    <table>
      <thead><tr><th>Name</th><th></th></tr></thead>
      <tbody>
        {connectors.map((c) => (
          <tr key={c.id}>
            <td>{c.name}</td>
            <td>
              <button className="sec" onClick={() => onSync(c.id)}>Sync</button>
              {onDelete ? <> <button className="sec" onClick={() => onDelete(c.id)}>Delete</button></> : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
