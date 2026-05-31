export function ConnectorList({ connectors, onSync }: { connectors: Array<{ id: string; name: string }>; onSync: (id: string) => void }) {
  if (connectors.length === 0) return <p style={{ color: '#8a929c' }}>None yet.</p>;
  return (
    <table>
      <thead><tr><th>Name</th><th></th></tr></thead>
      <tbody>
        {connectors.map((c) => (
          <tr key={c.id}><td>{c.name}</td><td><button className="sec" onClick={() => onSync(c.id)}>Sync</button></td></tr>
        ))}
      </tbody>
    </table>
  );
}
