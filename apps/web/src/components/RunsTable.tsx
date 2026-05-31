export interface PipelineRun { id: string; status: string; trigger: string; rowCount: number | null; error: string | null; startedAt: string; }

export function RunsTable({ runs }: { runs: PipelineRun[] }) {
  if (runs.length === 0) return <p style={{ color: '#8a929c' }}>No runs yet.</p>;
  return (
    <table>
      <thead><tr><th>Status</th><th>Trigger</th><th>Rows</th><th>Error</th></tr></thead>
      <tbody>
        {runs.map((r) => (
          <tr key={r.id}>
            <td><span className={`badge ${r.status}`}>{r.status}</span></td>
            <td>{r.trigger}</td>
            <td>{r.rowCount ?? ''}</td>
            <td style={{ color: '#f85149' }}>{r.error ?? ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
