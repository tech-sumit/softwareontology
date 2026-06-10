import { useCallback, useEffect, useState } from 'react';
import { api, type ObjectTypeSummary, type SavedDashboard } from '../api';
import { BarList } from '../components/BarList';

type MetricFn = 'count' | 'sum' | 'avg';
const NUMERIC_TYPES = ['int', 'float'];

export function DashboardsView() {
  const [types, setTypes] = useState<ObjectTypeSummary[]>([]);
  const [ot, setOt] = useState('');
  const [props, setProps] = useState<Array<{ apiName: string; type: string }>>([]);
  const [groupBy, setGroupBy] = useState('');
  const [fn, setFn] = useState<MetricFn>('count');
  const [property, setProperty] = useState('');
  const [buckets, setBuckets] = useState<Array<{ group: string; count: number; value?: number }>>([]);
  const [saved, setSaved] = useState<SavedDashboard[]>([]);
  const [dashName, setDashName] = useState('');
  const [err, setErr] = useState('');

  const refreshSaved = useCallback(() => {
    api.listDashboards().then((r) => setSaved(r.dashboards)).catch((e) => setErr((e as Error).message));
  }, []);

  useEffect(() => { api.listObjectTypes().then((r) => { setTypes(r.objectTypes); if (r.objectTypes[0]) setOt(r.objectTypes[0].apiName); }).catch((e) => setErr((e as Error).message)); }, []);
  useEffect(() => { refreshSaved(); }, [refreshSaved]);

  // Re-populate the group-by property picker whenever the object type changes (string-ish properties first).
  useEffect(() => {
    if (!ot) { setProps([]); setGroupBy(''); return; }
    api.getObjectType(ot).then((r) => {
      const all = r.objectType.properties.map((p) => ({ apiName: p.apiName, type: p.type }));
      const sorted = [...all.filter((p) => p.type === 'string'), ...all.filter((p) => p.type !== 'string')];
      setProps(sorted);
      setGroupBy(sorted[0]?.apiName ?? '');
      setProperty(sorted.find((p) => NUMERIC_TYPES.includes(p.type))?.apiName ?? '');
    }).catch((e) => { setProps([]); setGroupBy(''); setErr((e as Error).message); });
  }, [ot]);

  const numericProps = props.filter((p) => NUMERIC_TYPES.includes(p.type));

  async function run() {
    setErr('');
    try {
      const r = fn === 'count' ? await api.aggregate(ot, groupBy) : await api.aggregate(ot, groupBy, fn, property);
      setBuckets(r.buckets);
    } catch (e) { setErr((e as Error).message); }
  }

  async function save() {
    setErr('');
    if (!dashName.trim()) { setErr('dashboard name required'); return; }
    try {
      await api.saveDashboard({ name: dashName.trim(), objectType: ot, groupBy, fn, property: fn === 'count' ? null : property });
      setDashName('');
      refreshSaved();
    } catch (e) { setErr((e as Error).message); }
  }

  async function load(d: SavedDashboard) {
    setErr('');
    setOt(d.objectType); setGroupBy(d.groupBy); setFn(d.fn); setProperty(d.property ?? '');
    try {
      const r = d.fn === 'count' ? await api.aggregate(d.objectType, d.groupBy) : await api.aggregate(d.objectType, d.groupBy, d.fn, d.property ?? '');
      setBuckets(r.buckets);
    } catch (e) { setErr((e as Error).message); }
  }

  async function remove(id: string) {
    setErr('');
    try { await api.deleteDashboard(id); refreshSaved(); } catch (e) { setErr((e as Error).message); }
  }

  return (
    <div className="card">
      <h2>Dashboards</h2>
      <label htmlFor="dot">Object type</label>
      <select id="dot" value={ot} onChange={(e) => setOt(e.target.value)}>{types.map((t) => <option key={t.apiName} value={t.apiName}>{t.apiName}</option>)}</select>
      <label htmlFor="gb">Group by property</label>
      <select id="gb" aria-label="group by" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
        {props.map((p) => <option key={p.apiName} value={p.apiName}>{p.apiName}</option>)}
      </select>
      <label htmlFor="metric">Metric</label>
      <select id="metric" aria-label="metric" value={fn} onChange={(e) => setFn(e.target.value as MetricFn)}>
        <option value="count">count</option>
        <option value="sum">sum</option>
        <option value="avg">avg</option>
      </select>
      {fn !== 'count' ? (
        <>
          <label htmlFor="mprop">Of property</label>
          <select id="mprop" aria-label="metric property" value={property} onChange={(e) => setProperty(e.target.value)}>
            {numericProps.map((p) => <option key={p.apiName} value={p.apiName}>{p.apiName}</option>)}
          </select>
        </>
      ) : null}
      <div style={{ margin: '10px 0' }}><button onClick={run}>Aggregate</button></div>
      <BarList buckets={buckets} />
      <div className="field" style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
        <input aria-label="dashboard name" placeholder="Dashboard name" value={dashName} onChange={(e) => setDashName(e.target.value)} />
        <button onClick={save}>Save dashboard</button>
      </div>
      <h3>Saved dashboards</h3>
      {saved.length === 0 ? <p style={{ color: 'var(--muted)' }}>No saved dashboards yet.</p> : (
        <table>
          <thead><tr><th>Name</th><th>Type</th><th>Group by</th><th>Metric</th><th></th></tr></thead>
          <tbody>
            {saved.map((d) => (
              <tr key={d.id}>
                <td>{d.name}</td>
                <td>{d.objectType}</td>
                <td>{d.groupBy}</td>
                <td>{d.fn}{d.property ? `(${d.property})` : ''}</td>
                <td>
                  <button aria-label={`load dashboard ${d.name}`} onClick={() => load(d)}>Load</button>{' '}
                  <button className="sec" aria-label={`delete dashboard ${d.name}`} onClick={() => remove(d.id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {err ? <div className="err">{err}</div> : null}
    </div>
  );
}
