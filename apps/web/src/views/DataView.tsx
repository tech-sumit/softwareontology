import { useEffect, useState } from 'react';
import { api } from '../api';

export function DataView() {
  const [datasets, setDatasets] = useState<Array<{ id: string; name: string; rowCount?: number }>>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [sel, setSel] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { api.listDatasets().then((r) => setDatasets(r.datasets)).catch((e) => setErr((e as Error).message)); }, []);
  async function preview(id: string) { setSel(id); setErr(''); try { setRows((await api.datasetPreview(id)).rows); } catch (e) { setErr((e as Error).message); } }
  const cols = rows[0] ? Object.keys(rows[0]) : [];
  return (
    <div className="card">
      <h2>Data</h2>
      {datasets.length === 0 ? <p style={{ color: 'var(--muted)' }}>No datasets in this project. Upload one under "Upload &amp; model".</p> : (
        <table><thead><tr><th>Dataset</th><th>Rows</th></tr></thead>
          <tbody>{datasets.map((d) => <tr key={d.id} className={`rowlink${sel === d.id ? ' sel' : ''}`} onClick={() => preview(d.id)}><td>{d.name}</td><td>{d.rowCount ?? ''}</td></tr>)}</tbody>
        </table>
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
