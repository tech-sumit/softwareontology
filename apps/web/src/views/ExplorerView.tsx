import { useEffect, useState } from 'react';
import { api, type ObjectTypeSummary, type PropertyMeta } from '../api';
import { ObjectsTable } from '../components/ObjectsTable';

export function ExplorerView() {
  const [types, setTypes] = useState<ObjectTypeSummary[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [props, setProps] = useState<PropertyMeta[]>([]);
  const [pk, setPk] = useState('');
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [err, setErr] = useState('');

  useEffect(() => { api.listObjectTypes().then((r) => setTypes(r.objectTypes)).catch((e) => setErr(e.message)); }, []);
  useEffect(() => { if (types[0] && !active) setActive(types[0].apiName); }, [types, active]);

  useEffect(() => {
    if (!active) return;
    setSelected(undefined);
    void (async () => {
      try {
        const ot = await api.getObjectType(active);
        setProps(ot.objectType.properties); setPk(ot.objectType.primaryKey);
        setRows((await api.getObjects(active)).objects);
      } catch (e) { setErr((e as Error).message); }
    })();
  }, [active]);

  const columns = props.map((p) => p.apiName);
  const current = rows.find((r) => String(r[pk]) === selected);

  async function runStatusAction(value: string) {
    if (!active || !current) return;
    setErr('');
    try {
      // ensure a 'setStatus' modify action exists for this type, then execute it
      const defs = (await api.listActions()).actions;
      if (!defs.some((d) => d.apiName === `set_${active}_status`)) {
        await api.createAction({ apiName: `set_${active}_status`, objectType: active, kind: 'modify' });
      }
      await api.executeAction(`set_${active}_status`, { primaryKey: String(current[pk]), edits: { status: value } });
      setRows((await api.getObjects(active)).objects);
    } catch (e) { setErr((e as Error).message); }
  }

  if (types.length === 0) return <p style={{ color: '#8a929c' }}>No object types yet &mdash; use &ldquo;Upload &amp; model&rdquo;.</p>;

  return (
    <div className="row">
      <div className="side">
        <div className="label">OBJECT TYPES</div>
        {types.map((t) => (
          <div key={t.apiName} className={`ot ${active === t.apiName ? 'active' : ''}`} onClick={() => setActive(t.apiName)}>{t.apiName}</div>
        ))}
      </div>
      <div className="main">
        <ObjectsTable columns={columns} rows={rows} pk={pk} selected={selected} onSelect={setSelected} />
        {err ? <div className="err">{err}</div> : null}
      </div>
      {current ? (
        <div className="detail">
          <h3 style={{ marginTop: 0 }}>{String(current[pk])}</h3>
          {columns.map((c) => (<div key={c}><div className="k">{c}</div><div className="v">{String(current[c] ?? '')}</div></div>))}
          {props.some((p) => p.apiName === 'status') ? (
            <div style={{ marginTop: 12 }}>
              <div className="label">ACTIONS</div>
              <button onClick={() => runStatusAction('Cancelled')}>Set status: Cancelled</button>{' '}
              <button className="sec" onClick={() => runStatusAction('On time')}>Set status: On time</button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
