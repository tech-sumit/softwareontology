import { useEffect, useState } from 'react';
import { api, type ObjectTypeSummary } from '../api';
import { BarList } from '../components/BarList';

export function DashboardsView() {
  const [types, setTypes] = useState<ObjectTypeSummary[]>([]);
  const [ot, setOt] = useState('');
  const [props, setProps] = useState<Array<{ apiName: string; type: string }>>([]);
  const [groupBy, setGroupBy] = useState('');
  const [buckets, setBuckets] = useState<Array<{ group: string; count: number }>>([]);
  const [err, setErr] = useState('');

  useEffect(() => { api.listObjectTypes().then((r) => { setTypes(r.objectTypes); if (r.objectTypes[0]) setOt(r.objectTypes[0].apiName); }).catch((e) => setErr((e as Error).message)); }, []);

  // Re-populate the group-by property picker whenever the object type changes (string-ish properties first).
  useEffect(() => {
    if (!ot) { setProps([]); setGroupBy(''); return; }
    api.getObjectType(ot).then((r) => {
      const all = r.objectType.properties.map((p) => ({ apiName: p.apiName, type: p.type }));
      const sorted = [...all.filter((p) => p.type === 'string'), ...all.filter((p) => p.type !== 'string')];
      setProps(sorted);
      setGroupBy(sorted[0]?.apiName ?? '');
    }).catch((e) => { setProps([]); setGroupBy(''); setErr((e as Error).message); });
  }, [ot]);

  async function run() {
    setErr('');
    try { setBuckets((await api.aggregate(ot, groupBy)).buckets); } catch (e) { setErr((e as Error).message); }
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
      <div style={{ margin: '10px 0' }}><button onClick={run}>Aggregate</button></div>
      <BarList buckets={buckets} />
      {err ? <div className="err">{err}</div> : null}
    </div>
  );
}
