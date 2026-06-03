import { useEffect, useState } from 'react';
import { api, type SearchHit, type AuditEntry } from '../api';

function Rows({ rows }: { rows: Array<Record<string, unknown>> }) {
  const cols = rows[0] ? Object.keys(rows[0]) : [];
  return (
    <table>
      <thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>{cols.map((c) => <td key={c}>{r[c] === null || r[c] === undefined ? '' : String(r[c])}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}

export function CatalogView({ initialQuery }: { initialQuery?: string } = {}) {
  const [q, setQ] = useState(initialQuery ?? '');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searchErr, setSearchErr] = useState('');
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [auditErr, setAuditErr] = useState('');

  useEffect(() => { api.catalogAudit().then((r) => setAudit(r.entries)).catch((e) => setAuditErr((e as Error).message)); }, []);

  async function search(query: string) {
    setSearchErr(''); setHits(null);
    if (!query.trim()) return;
    try { setHits((await api.catalogSearch(query.trim())).hits); }
    catch (e) { setSearchErr((e as Error).message); }
  }

  useEffect(() => { if (initialQuery && initialQuery.trim()) void search(initialQuery); }, [initialQuery]);

  return (
    <div className="card">
      <h2>Catalog</h2>
      <p style={{ color: 'var(--muted)' }}>Search object types, datasets, and actions across this org; review the audit log.</p>

      <div style={{ borderTop: '1px solid var(--line)', marginTop: 12, paddingTop: 12 }}>
        <h3>Search</h3>
        <label htmlFor="catalog-q">Query</label>{' '}
        <input id="catalog-q" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void search(q); }} placeholder="orders" />{' '}
        <button onClick={() => void search(q)}>Search</button>
        {hits ? (hits.length === 0 ? <p style={{ color: 'var(--muted)' }}>No results.</p> : <div style={{ marginTop: 8 }}><Rows rows={hits as unknown as Array<Record<string, unknown>>} /></div>) : null}
        {searchErr ? <div className="err">{searchErr}</div> : null}
      </div>

      <div style={{ borderTop: '1px solid var(--line)', marginTop: 16, paddingTop: 12 }}>
        <h3>Audit log</h3>
        {audit.length === 0 ? <p style={{ color: 'var(--muted)' }}>No audit entries.</p> : <Rows rows={audit as unknown as Array<Record<string, unknown>>} />}
        {auditErr ? <div className="err">{auditErr}</div> : null}
      </div>
    </div>
  );
}
