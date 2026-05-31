export interface Endpoint { method: string; path: string; }

export function EndpointList({ endpoints }: { endpoints: Endpoint[] }) {
  if (endpoints.length === 0) return <p style={{ color: '#8a929c' }}>No endpoints.</p>;
  return (
    <table>
      <thead><tr><th>Method</th><th>Path</th></tr></thead>
      <tbody>
        {endpoints.map((e, i) => (
          <tr key={i}><td><span className="badge running">{e.method.toUpperCase()}</span></td><td><code>{e.path}</code></td></tr>
        ))}
      </tbody>
    </table>
  );
}
