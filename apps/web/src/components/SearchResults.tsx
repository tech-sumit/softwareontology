export type SearchHit = { primaryKey: string; score: number; doc: string };
export function SearchResults({ hits }: { hits: SearchHit[] }) {
  if (hits.length === 0) return <p className="muted">No results yet — index a type, then search.</p>;
  return (
    <ul className="searchres" style={{ listStyle: 'none', padding: 0 }}>
      {hits.map((h) => (
        <li key={h.primaryKey} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
          <span className="badge">{h.score.toFixed(3)}</span> <strong>{h.primaryKey}</strong>
          <div className="muted" style={{ fontSize: 13 }}>{h.doc}</div>
        </li>
      ))}
    </ul>
  );
}
