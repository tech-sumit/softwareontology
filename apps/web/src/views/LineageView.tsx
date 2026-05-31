import { useEffect, useState } from 'react';
import { api, type ObjectTypeSummary, type ObjectTypeLineage } from '../api';

export function LineageView() {
  const [types, setTypes] = useState<ObjectTypeSummary[]>([]);
  const [selected, setSelected] = useState('');
  const [lineage, setLineage] = useState<ObjectTypeLineage | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => { api.listObjectTypes().then((r) => setTypes(r.objectTypes)).catch((e) => setErr((e as Error).message)); }, []);

  async function pick(apiName: string) {
    setSelected(apiName); setErr(''); setLineage(null);
    if (!apiName) return;
    try { setLineage((await api.getLineage(apiName)).lineage); }
    catch (e) { setErr((e as Error).message); }
  }

  const actions = lineage?.actions ?? [];
  const links = lineage?.links ?? [];

  return (
    <div className="card">
      <h2>Lineage</h2>
      <p style={{ color: '#8a929c' }}>Pick an object type to see its backing dataset, actions, and links.</p>
      {types.length === 0 ? <p style={{ color: '#8a929c' }}>No object types yet &mdash; use &ldquo;Upload &amp; model&rdquo;.</p> : (
        <div>
          <label htmlFor="lineage-type">Object type</label>{' '}
          <select id="lineage-type" value={selected} onChange={(e) => void pick(e.target.value)}>
            <option value="">Select&hellip;</option>
            {types.map((t) => <option key={t.apiName} value={t.apiName}>{t.apiName}</option>)}
          </select>
        </div>
      )}
      {lineage ? (
        <div style={{ marginTop: 12 }}>
          <div><div className="label">BACKING DATASET</div><div>{lineage.backingDataset ?? <span style={{ color: '#8a929c' }}>none</span>}</div></div>
          <div style={{ marginTop: 12 }}>
            <div className="label">ACTIONS</div>
            {actions.length === 0 ? <span style={{ color: '#8a929c' }}>none</span> : <ul>{actions.map((a) => <li key={a}>{a}</li>)}</ul>}
          </div>
          <div style={{ marginTop: 12 }}>
            <div className="label">LINKS</div>
            {links.length === 0 ? <span style={{ color: '#8a929c' }}>none</span> : <ul>{links.map((l) => <li key={l}>{l}</li>)}</ul>}
          </div>
        </div>
      ) : null}
      {err ? <div className="err">{err}</div> : null}
    </div>
  );
}
