export function BarList({ buckets }: { buckets: Array<{ group: string; count: number; value?: number }> }) {
  if (buckets.length === 0) return <p style={{ color: 'var(--muted)' }}>No data.</p>;
  const metric = (b: { count: number; value?: number }) => b.value ?? b.count;
  const max = Math.max(...buckets.map((b) => Math.abs(metric(b))), 1);
  return (
    <div>
      {buckets.map((b) => (
        <div key={b.group} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0' }}>
          <div style={{ width: 140, fontSize: 13 }}>{b.group}</div>
          <div style={{ height: 18, width: `${Math.round((Math.abs(metric(b)) / max) * 280)}px`, background: '#4a7fd4', borderRadius: 4 }} />
          <div style={{ fontSize: 13 }}>{metric(b)}</div>
        </div>
      ))}
    </div>
  );
}
