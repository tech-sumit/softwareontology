import { useEffect, useState } from 'react';
import { api } from '../api';
import { ObjectsTable } from '../components/ObjectsTable';
import { ObjectDetail } from '../components/ObjectDetail';

interface Link { apiName: string; fromObjectType: string; toObjectType: string; foreignKeyProperty: string }
interface TypeDetail { apiName: string; primaryKey: string; properties: Array<{ apiName: string }>; links: Link[] }
interface ActionDef { apiName: string; objectType: string; kind: string }

function parseEdits(raw: string): Record<string, unknown> {
  const edits: Record<string, unknown> = {};
  for (const pair of raw.split(',')) {
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    const key = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (key) edits[key] = value;
  }
  return edits;
}

export function ObjectExplorer() {
  const [types, setTypes] = useState<Array<{ apiName: string }>>([]);
  const [active, setActive] = useState<string | null>(null);
  const [detail, setDetail] = useState<TypeDetail | null>(null);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [actions, setActions] = useState<ActionDef[]>([]);
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [linked, setLinked] = useState<Record<string, Record<string, unknown>[]>>({});
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => { api.listObjectTypes().then((r) => setTypes(r.objectTypes)).catch((e) => setErr((e as Error).message)); }, []);

  async function selectType(name: string) {
    setActive(name); setErr(''); setMsg(''); setSelected(undefined); setDetail(null); setRows([]); setActions([]); setLinked({});
    try {
      const ot = (await api.getObjectType(name)).objectType;
      setDetail({ apiName: ot.apiName, primaryKey: ot.primaryKey, properties: ot.properties, links: ot.links });
      setRows((await api.getObjects(name)).objects);
      setActions((await api.listActions()).actions.filter((a) => a.objectType === name));
    } catch (e) { setErr((e as Error).message); }
  }

  async function loadLinked(typeName: string, pk: string, links: Link[]) {
    setLinked({});
    for (const link of links) {
      try {
        const objs = (await api.resolveLinkedObjects(typeName, pk, link.apiName)).objects;
        setLinked((prev) => ({ ...prev, [link.apiName]: objs }));
      } catch { /* skip links that fail to resolve */ }
    }
  }

  function selectObject(id: string) {
    setSelected(id); setMsg(''); setErr('');
    if (detail) void loadLinked(detail.apiName, id, detail.links);
  }

  async function runAction(apiName: string) {
    if (!detail || selected === undefined) return;
    setErr(''); setMsg('');
    const raw = window.prompt(`Edits for "${apiName}" as key=value,key=value`, '');
    if (raw === null) return;
    try {
      await api.executeAction(apiName, { primaryKey: selected, edits: parseEdits(raw) });
      const fresh = (await api.getObjects(detail.apiName)).objects;
      setRows(fresh);
      setSelected(selected);
      void loadLinked(detail.apiName, selected, detail.links);
      setMsg(`Ran "${apiName}".`);
    } catch (e) { setErr((e as Error).message); }
  }

  const pk = detail?.primaryKey ?? '';
  const columns = detail ? detail.properties.map((p) => p.apiName) : [];
  const selectedRow = selected !== undefined ? rows.find((r) => String(r[pk]) === selected) : undefined;

  return (
    <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
      <div className="card" style={{ width: 220, padding: 14, flexShrink: 0 }}>
        <div className="label" style={{ color: 'var(--muted)' }}>OBJECT TYPES</div>
        {types.length === 0 ? <p className="muted" style={{ fontSize: 13 }}>None yet.</p> : (
          <ul className="plain" style={{ margin: '8px 0' }}>
            {types.map((t) => (
              <li key={t.apiName} className={active === t.apiName ? 'sel' : ''} style={{ cursor: 'pointer', padding: '6px 8px', borderRadius: 6, fontWeight: 600 }} onClick={() => void selectType(t.apiName)}>{t.apiName}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="card" style={{ flex: 1, minWidth: 0, padding: 16 }}>
        {detail ? (
          <>
            <h2 style={{ marginTop: 0 }}>{detail.apiName}</h2>
            <div className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>primary key: <b style={{ color: 'var(--ink)' }}>{detail.primaryKey}</b> · <span className="badge">{rows.length} objects</span></div>
            <ObjectsTable columns={columns} rows={rows} pk={pk} selected={selected} onSelect={selectObject} />
          </>
        ) : (
          <p className="muted">Select an object type to browse its objects.</p>
        )}
        {err ? <div className="err">{err}</div> : null}
      </div>

      {detail && selectedRow ? (
        <div className="card" style={{ width: 340, flexShrink: 0, padding: 16 }}>
          <h2 style={{ marginTop: 0 }}>{String(selectedRow[pk])}</h2>
          <ObjectDetail object={selectedRow} actions={actions.map((a) => ({ apiName: a.apiName, kind: a.kind }))} onRun={(name) => void runAction(name)} />

          {detail.links.length > 0 ? (
            <div style={{ marginTop: 18 }}>
              <h3>Linked objects</h3>
              {detail.links.map((link) => {
                const objs = linked[link.apiName];
                return (
                  <div key={link.apiName} style={{ marginTop: 12 }}>
                    <div className="muted" style={{ fontSize: 12.5, marginBottom: 4 }}><b style={{ color: 'var(--ink)' }}>{link.apiName}</b> → {link.toObjectType}</div>
                    {objs === undefined ? <p className="muted" style={{ fontSize: 12 }}>Loading…</p>
                      : objs.length === 0 ? <p className="muted" style={{ fontSize: 12 }}>No linked objects.</p>
                      : <ObjectsTable columns={Object.keys(objs[0] ?? {})} rows={objs} pk={Object.keys(objs[0] ?? {})[0] ?? ''} onSelect={() => {}} />}
                  </div>
                );
              })}
            </div>
          ) : null}

          {msg ? <div style={{ color: '#3fb950', marginTop: 8 }}>{msg}</div> : null}
          {err ? <div className="err">{err}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
