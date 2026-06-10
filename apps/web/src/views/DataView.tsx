import { useEffect, useState } from 'react';
import { api } from '../api';
import { timeAgo } from '../time';

const PAGE = 50;

export function DataView() {
  const [datasets, setDatasets] = useState<Array<{ id: string; name: string; rowCount?: number; createdAt?: string }>>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [sel, setSel] = useState('');
  const [filter, setFilter] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [err, setErr] = useState('');
  useEffect(() => { api.listDatasets().then((r) => setDatasets(r.datasets)).catch((e) => setErr((e as Error).message)); }, []);
  async function preview(id: string) { setSel(id); setErr(''); try { setRows((await api.datasetPreview(id)).rows); } catch (e) { setErr((e as Error).message); } }
  const cols = rows[0] ? Object.keys(rows[0]) : [];
  const needle = filter.trim().toLowerCase();
  const filtered = needle ? datasets.filter((d) => d.name.toLowerCase().includes(needle)) : datasets;
  const visible = filtered.slice(0, shown);
  return (
    <div className="card">
      <h2>Data</h2>
      {datasets.length === 0 ? <p style={{ color: 'var(--muted)' }}>No datasets in this project. Upload one under "Upload &amp; model".</p> : (
        <>
          <input aria-label="filter datasets" value={filter} onChange={(e) => { setFilter(e.target.value); setShown(PAGE); }} placeholder="Filter by name…" style={{ marginBottom: 8, width: 260 }} />
          {filtered.length === 0 ? <p style={{ color: 'var(--muted)' }}>No datasets match the filter.</p> : (
            <table><thead><tr><th>Dataset</th><th>Rows</th><th>Created</th></tr></thead>
              <tbody>{visible.map((d) => (
                <tr key={d.id} className={`rowlink${sel === d.id ? ' sel' : ''}`} onClick={() => preview(d.id)}>
                  <td>{d.name} <span style={{ color: 'var(--muted)', fontSize: 11.5 }}>{d.id.slice(0, 8)}</span></td>
                  <td>{d.rowCount ?? ''}</td>
                  <td title={d.createdAt ?? ''}>{d.createdAt ? timeAgo(d.createdAt) : ''}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
          {filtered.length > shown ? <button className="sec" style={{ marginTop: 8 }} onClick={() => setShown((n) => n + PAGE)}>Show more ({filtered.length - shown} more)</button> : null}
        </>
      )}
      {rows.length > 0 ? (
        <table style={{ marginTop: 12 }}><thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c}>{r[c] === null || r[c] === undefined ? '' : String(r[c])}</td>)}</tr>)}</tbody>
        </table>
      ) : null}
      {err ? <div className="err">{err}</div> : null}
    </div>
  );
}
