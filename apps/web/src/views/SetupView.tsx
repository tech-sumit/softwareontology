import { useState } from 'react';
import { api } from '../api';

export function SetupView({ onModeled }: { onModeled: () => void }) {
  const [csv, setCsv] = useState('');
  const [name, setName] = useState('');
  const [otName, setOtName] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  async function run() {
    setErr(''); setMsg('');
    try {
      const { dataset } = await api.uploadCsv(name, csv);
      await api.createObjectType({
        apiName: otName, datasetId: dataset.id, primaryKey: 'flightNumber',
        properties: [
          { apiName: 'flightNumber', column: 'flight_no', type: 'string' },
          { apiName: 'status', column: 'status', type: 'string' },
          { apiName: 'seats', column: 'seats', type: 'int' },
        ],
      });
      setMsg(`Modeled "${otName}" from dataset "${name}".`);
      onModeled();
    } catch (e) { setErr((e as Error).message); }
  }

  return (
    <div className="card pad formcard">
      <h2>Upload &amp; model</h2>
      <div className="frow">
        <div className="field">
          <label htmlFor="dsname">Dataset name</label>
          <input id="dsname" value={name} placeholder="flights" onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="ot">Object type name</label>
          <input id="ot" value={otName} placeholder="Flight" onChange={(e) => setOtName(e.target.value)} />
        </div>
      </div>
      <div className="field" style={{ marginTop: 14 }}>
        <label htmlFor="csv">CSV</label>
        <textarea id="csv" rows={6} value={csv} placeholder={'flight_no,status,seats\nFL-204,Delayed,189\nFL-118,Boarding,142'} onChange={(e) => setCsv(e.target.value)} />
      </div>
      <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 0 }}>Maps flight_no&rarr;flightNumber, status&rarr;status, seats&rarr;seats (int).</p>
      <button onClick={run}>Upload &amp; model</button>
      {msg ? <div style={{ color: '#1e7a44', marginTop: 8 }}>{msg}</div> : null}
      {err ? <div className="err">{err}</div> : null}
    </div>
  );
}
