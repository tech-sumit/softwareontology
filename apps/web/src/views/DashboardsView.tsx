import { useEffect, useState } from 'react';
import { api, type ObjectTypeSummary } from '../api';
import { BarList } from '../components/BarList';

export function DashboardsView() {
  const [types, setTypes] = useState<ObjectTypeSummary[]>([]);
  const [ot, setOt] = useState('');
  const [groupBy, setGroupBy] = useState('status');
  const [buckets, setBuckets] = useState<Array<{ group: string; count: number }>>([]);
  const [err, setErr] = useState('');

  useEffect(() => { api.listObjectTypes().then((r) => { setTypes(r.objectTypes); if (r.objectTypes[0]) setOt(r.objectTypes[0].apiName); }).catch((e) => setErr((e as Error).message)); }, []);

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
      <input id="gb" value={groupBy} onChange={(e) => setGroupBy(e.target.value)} />
      <div style={{ margin: '10px 0' }}><button onClick={run}>Aggregate</button></div>
      <BarList buckets={buckets} />
      {err ? <div className="err">{err}</div> : null}
    </div>
  );
}
