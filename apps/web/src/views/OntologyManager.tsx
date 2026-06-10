import { useEffect, useState } from 'react';
import { api } from '../api';
import { PropertyTable, type Prop } from '../components/PropertyTable';
import { ObjectsTable } from '../components/ObjectsTable';

interface Fn { apiName: string; expression: string; type: string }
interface Link { apiName: string; fromObjectType: string; toObjectType: string; foreignKeyProperty: string }
interface ActionDef { apiName: string; objectType: string; kind: string }
interface Detail { apiName: string; datasetId: string; primaryKey: string; properties: Prop[]; functions: Fn[]; links: Link[] }

const TYPES = ['string', 'int', 'float', 'bool', 'timestamp'] as const;
const ACTION_KINDS = ['modify', 'create'] as const;

interface NewProp { apiName: string; column: string; type: string }

export function OntologyManager() {
  const [types, setTypes] = useState<Array<{ apiName: string }>>([]);
  const [typeFilter, setTypeFilter] = useState('');
  const [active, setActive] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [objects, setObjects] = useState<Record<string, unknown>[] | null>(null);
  const [objSel, setObjSel] = useState<string | undefined>(undefined);
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  // Add-function form
  const [fnName, setFnName] = useState('');
  const [fnExpr, setFnExpr] = useState('');
  const [fnType, setFnType] = useState<string>('string');
  // Add-link form
  const [lkName, setLkName] = useState('');
  const [lkTo, setLkTo] = useState('');
  const [lkFk, setLkFk] = useState('');
  // Actions
  const [actions, setActions] = useState<ActionDef[]>([]);
  const [acName, setAcName] = useState('');
  const [acKind, setAcKind] = useState<string>('modify');
  // New-object-type form
  const [datasets, setDatasets] = useState<Array<{ id: string; name: string }>>([]);
  const [otName, setOtName] = useState('');
  const [otDatasetId, setOtDatasetId] = useState('');
  const [otProps, setOtProps] = useState<NewProp[]>([]);
  const [otPk, setOtPk] = useState('');

  async function loadTypes() {
    try { setTypes((await api.listObjectTypes()).objectTypes); } catch (e) { setErr((e as Error).message); }
  }
  async function loadDetail(name: string) {
    setErr(''); setObjects(null); setObjSel(undefined);
    try {
      setDetail((await api.getObjectType(name)).objectType);
      setActions((await api.listActions()).actions.filter((a) => a.objectType === name));
    } catch (e) { setErr((e as Error).message); }
  }
  useEffect(() => { void loadTypes(); }, []);
  useEffect(() => { if (active) void loadDetail(active); else setDetail(null); }, [active]);

  function selectType(name: string) { setCreating(false); setMsg(''); setActive(name); }

  async function openNew() {
    setCreating(true); setActive(null); setDetail(null); setMsg(''); setErr('');
    setOtName(''); setOtDatasetId(''); setOtProps([]); setOtPk('');
    try { setDatasets((await api.listDatasets()).datasets); } catch (e) { setErr((e as Error).message); }
  }
  async function pickDataset(id: string) {
    setOtDatasetId(id);
    if (!id) { setOtProps([]); setOtPk(''); return; }
    setErr('');
    try {
      const cols = (await api.getDataset(id)).dataset.columns;
      setOtProps(cols.map((c) => ({ apiName: c.name, column: c.name, type: 'string' })));
      setOtPk(cols[0]?.name ?? '');
    } catch (e) { setErr((e as Error).message); }
  }
  async function submitNew() {
    setErr(''); setMsg('');
    try {
      await api.createObjectType({ apiName: otName.trim(), datasetId: otDatasetId, primaryKey: otPk, properties: otProps });
      setMsg(`Created object type "${otName.trim()}".`);
      setCreating(false);
      await loadTypes();
      setActive(otName.trim());
    } catch (e) { setErr((e as Error).message); }
  }

  async function secure(name: string, prop: string, perm: string | null) {
    setErr(''); setMsg('');
    try { await api.setPropertySecurity(name, prop, perm); await loadDetail(name); setMsg(`Updated security for "${prop}".`); }
    catch (e) { setErr((e as Error).message); }
  }
  async function addFunction() {
    if (!active) return;
    setErr(''); setMsg('');
    try { await api.createFunction(active, { apiName: fnName.trim(), expression: fnExpr, type: fnType }); setFnName(''); setFnExpr(''); await loadDetail(active); setMsg(`Added function "${fnName.trim()}".`); }
    catch (e) { setErr((e as Error).message); }
  }
  async function addLink() {
    if (!active) return;
    setErr(''); setMsg('');
    try { await api.createLinkType({ apiName: lkName.trim(), fromObjectType: active, toObjectType: lkTo, foreignKeyProperty: lkFk }); setLkName(''); setLkTo(''); setLkFk(''); await loadDetail(active); setMsg(`Added link "${lkName.trim()}".`); }
    catch (e) { setErr((e as Error).message); }
  }
  async function addAction() {
    if (!active) return;
    setErr(''); setMsg('');
    try { await api.createAction({ apiName: acName.trim(), objectType: active, kind: acKind }); setAcName(''); setAcKind('modify'); await loadDetail(active); setMsg(`Added action "${acName.trim()}".`); }
    catch (e) { setErr((e as Error).message); }
  }
  async function browse() {
    if (!active) return;
    setErr('');
    try { setObjects((await api.getObjects(active)).objects); } catch (e) { setErr((e as Error).message); }
  }

  return (
    <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
      <div className="card" style={{ width: 240, padding: 14, flexShrink: 0 }}>
        <div className="label" style={{ color: 'var(--muted)' }}>OBJECT TYPES</div>
        {types.length === 0 ? <p className="muted" style={{ fontSize: 13 }}>None yet.</p> : (
          <>
            <input aria-label="filter types" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} placeholder="Filter…" style={{ width: '100%', marginTop: 8, boxSizing: 'border-box' }} />
            <ul className="plain" style={{ margin: '8px 0' }}>
              {types.filter((t) => t.apiName.toLowerCase().includes(typeFilter.trim().toLowerCase())).map((t) => (
                <li key={t.apiName} className={`listln${active === t.apiName ? ' sel' : ''}`} style={{ fontWeight: 600 }} onClick={() => selectType(t.apiName)}>{t.apiName}</li>
              ))}
            </ul>
          </>
        )}
        <button onClick={() => void openNew()}>New object type</button>
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        {creating ? (
          <div className="card" style={{ padding: 16 }}>
            <h2 style={{ marginTop: 0 }}>New object type</h2>
            <label htmlFor="ds">Backing dataset</label>{' '}
            <select id="ds" value={otDatasetId} onChange={(e) => void pickDataset(e.target.value)}>
              <option value="">Select a dataset…</option>
              {datasets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            {otProps.length > 0 ? (
              <>
                <div style={{ marginTop: 12 }}>
                  <label htmlFor="otn">API name</label>{' '}
                  <input id="otn" value={otName} onChange={(e) => setOtName(e.target.value)} placeholder="Flight" />
                </div>
                <div style={{ marginTop: 8 }}>
                  <label htmlFor="pk">Primary key</label>{' '}
                  <select id="pk" value={otPk} onChange={(e) => setOtPk(e.target.value)}>
                    {otProps.map((p) => <option key={p.column} value={p.apiName}>{p.apiName}</option>)}
                  </select>
                </div>
                <table style={{ marginTop: 12 }}>
                  <thead><tr><th>Property</th><th>Column</th><th>Type</th></tr></thead>
                  <tbody>
                    {otProps.map((p, i) => (
                      <tr key={p.column}>
                        <td>
                          <input aria-label={`prop ${i} apiName`} value={p.apiName} onChange={(e) => setOtProps((ps) => ps.map((x, j) => j === i ? { ...x, apiName: e.target.value } : x))} />
                        </td>
                        <td className="muted">{p.column}</td>
                        <td>
                          <select aria-label={`prop ${i} type`} value={p.type} onChange={(e) => setOtProps((ps) => ps.map((x, j) => j === i ? { ...x, type: e.target.value } : x))}>
                            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ marginTop: 12 }}>
                  <button onClick={() => void submitNew()}>Create object type</button>{' '}
                  <button className="sec" onClick={() => { setCreating(false); }}>Cancel</button>
                </div>
              </>
            ) : <p className="muted" style={{ marginTop: 12 }}>Select a dataset to model its columns as properties.</p>}
            {msg ? <div style={{ color: '#3fb950', marginTop: 8 }}>{msg}</div> : null}
            {err ? <div className="err">{err}</div> : null}
          </div>
        ) : detail ? (
          <div className="card" style={{ padding: 16 }}>
            <h2 style={{ marginTop: 0 }}>{detail.apiName}</h2>
            <div className="row" style={{ gap: 18, fontSize: 12.5, color: 'var(--muted)', marginBottom: 14 }}>
              <span>primary key: <b style={{ color: 'var(--ink)' }}>{detail.primaryKey}</b></span>
              <span>dataset: <b style={{ color: 'var(--ink)' }}>{detail.datasetId}</b></span>
            </div>

            <h3>Properties</h3>
            <PropertyTable properties={detail.properties} onSecure={(p, perm) => void secure(detail.apiName, p, perm)} />

            <h3 style={{ marginTop: 22 }}>Functions</h3>
            {detail.functions.length === 0 ? <p className="muted">No computed functions.</p> : (
              <table>
                <thead><tr><th>Function</th><th>Expression</th><th>Type</th></tr></thead>
                <tbody>
                  {detail.functions.map((f) => (
                    <tr key={f.apiName}><td><b>{f.apiName}</b></td><td className="muted">{f.expression}</td><td>{f.type}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="row" style={{ marginTop: 10, gap: 6, flexWrap: 'wrap' }}>
              <input aria-label="function apiName" value={fnName} onChange={(e) => setFnName(e.target.value)} placeholder="apiName" style={{ width: 130 }} />
              <input aria-label="function expression" value={fnExpr} onChange={(e) => setFnExpr(e.target.value)} placeholder="expression (SQL)" style={{ width: 260 }} />
              <select aria-label="function type" value={fnType} onChange={(e) => setFnType(e.target.value)}>
                {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <button className="sec" onClick={() => void addFunction()}>Add function</button>
            </div>

            <h3 style={{ marginTop: 22 }}>Links</h3>
            {detail.links.length === 0 ? <p className="muted">No links.</p> : (
              <ul className="plain">
                {detail.links.map((l) => (
                  <li key={l.apiName} style={{ padding: '3px 0' }}><b>{l.apiName}</b> → {l.toObjectType} <span className="muted">(fk: {l.foreignKeyProperty})</span></li>
                ))}
              </ul>
            )}
            <div className="row" style={{ marginTop: 10, gap: 6, flexWrap: 'wrap' }}>
              <input aria-label="link apiName" value={lkName} onChange={(e) => setLkName(e.target.value)} placeholder="apiName" style={{ width: 130 }} />
              <select aria-label="link target" value={lkTo} onChange={(e) => setLkTo(e.target.value)}>
                <option value="">To object type…</option>
                {types.map((t) => <option key={t.apiName} value={t.apiName}>{t.apiName}</option>)}
              </select>
              <select aria-label="link fk" value={lkFk} onChange={(e) => setLkFk(e.target.value)}>
                <option value="">Foreign-key property…</option>
                {detail.properties.map((p) => <option key={p.apiName} value={p.apiName}>{p.apiName}</option>)}
              </select>
              <button className="sec" onClick={() => void addLink()}>Add link</button>
            </div>

            <h3 style={{ marginTop: 22 }}>Actions</h3>
            {actions.length === 0 ? <p className="muted">No actions.</p> : (
              <ul className="plain">
                {actions.map((a) => (
                  <li key={a.apiName} style={{ padding: '3px 0' }}><b>{a.apiName}</b> <span className="muted">· {a.kind}</span></li>
                ))}
              </ul>
            )}
            <div className="row" style={{ marginTop: 10, gap: 6, flexWrap: 'wrap' }}>
              <input aria-label="action apiName" value={acName} onChange={(e) => setAcName(e.target.value)} placeholder="apiName" style={{ width: 130 }} />
              <select aria-label="action kind" value={acKind} onChange={(e) => setAcKind(e.target.value)}>
                {ACTION_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
              <button className="sec" onClick={() => void addAction()}>Add action</button>
            </div>

            <h3 style={{ marginTop: 22 }}>Objects</h3>
            <button className="sec" onClick={() => void browse()}>Browse objects</button>
            {objects ? (
              <div style={{ marginTop: 10 }}>
                <ObjectsTable columns={detail.properties.map((p) => p.apiName)} rows={objects} pk={detail.primaryKey} selected={objSel} onSelect={setObjSel} />
              </div>
            ) : null}

            {msg ? <div style={{ color: '#3fb950', marginTop: 8 }}>{msg}</div> : null}
            {err ? <div className="err">{err}</div> : null}
          </div>
        ) : (
          <div className="card" style={{ padding: 16 }}>
            <p className="muted">Select an object type to manage its properties, functions and links — or create a new one.</p>
            {err ? <div className="err">{err}</div> : null}
          </div>
        )}
      </div>
    </div>
  );
}
