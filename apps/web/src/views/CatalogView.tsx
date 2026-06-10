import { useEffect, useState } from 'react';
import { api, type SearchHit, type AuditEntry } from '../api';
import { timeAgo } from '../time';

const AUDIT_PAGE = 50;

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
  const [auditDone, setAuditDone] = useState(false);
  const [auditFilter, setAuditFilter] = useState('');
  const [auditErr, setAuditErr] = useState('');

  useEffect(() => {
    api.catalogAudit({ limit: AUDIT_PAGE, offset: 0 })
      .then((r) => { setAudit(r.entries); setAuditDone(r.entries.length < AUDIT_PAGE); })
      .catch((e) => setAuditErr((e as Error).message));
  }, []);

  async function showMoreAudit() {
    setAuditErr('');
    try {
      const r = await api.catalogAudit({ limit: AUDIT_PAGE, offset: audit.length });
      setAudit((prev) => [...prev, ...r.entries]);
      if (r.entries.length < AUDIT_PAGE) setAuditDone(true);
    } catch (e) { setAuditErr((e as Error).message); }
  }

  async function search(query: string) {
    setSearchErr(''); setHits(null);
    if (!query.trim()) return;
    try { setHits((await api.catalogSearch(query.trim())).hits); }
    catch (e) { setSearchErr((e as Error).message); }
  }

  useEffect(() => { if (initialQuery && initialQuery.trim()) void search(initialQuery); }, [initialQuery]);

  const needle = auditFilter.trim().toLowerCase();
  const shownAudit = needle
    ? audit.filter((e) => [e.action, e.objectType, e.actor ?? '', e.actorEmail ?? ''].some((v) => v.toLowerCase().includes(needle)))
    : audit;

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
        <input aria-label="filter audit" value={auditFilter} onChange={(e) => setAuditFilter(e.target.value)} placeholder="Filter by action, object type, or actor…" style={{ marginBottom: 8, width: 280 }} />
        {audit.length === 0 ? <p style={{ color: 'var(--muted)' }}>No audit entries.</p> :
          shownAudit.length === 0 ? <p style={{ color: 'var(--muted)' }}>No entries match the filter.</p> : (
          <table>
            <thead><tr><th>Actor</th><th>Action</th><th>Object type</th><th>Key</th><th>When</th></tr></thead>
            <tbody>
              {shownAudit.map((e, i) => (
                <tr key={i}>
                  <td>{e.actorEmail ?? e.actor ?? ''}</td>
                  <td>{e.action}</td>
                  <td>{e.objectType}</td>
                  <td>{e.primaryKey ?? ''}</td>
                  <td title={e.createdAt}>{timeAgo(e.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!auditDone && audit.length > 0 ? <button className="sec" style={{ marginTop: 8 }} onClick={() => void showMoreAudit()}>Show more</button> : null}
        {auditErr ? <div className="err">{auditErr}</div> : null}
      </div>
    </div>
  );
}
