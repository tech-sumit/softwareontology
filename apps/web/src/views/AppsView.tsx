import { useEffect, useState } from 'react';
import { api, type AppDefinition, type AppWidget, type ObjectTypeSummary } from '../api';
import { AppRuntime } from '../components/AppRuntime';

type Mode = 'list' | 'edit' | 'run';
let widgetSeq = 0;
function newWidgetId(): string { widgetSeq += 1; return `w${Date.now()}_${widgetSeq}`; }

export function AppsView() {
  const [mode, setMode] = useState<Mode>('list');
  const [apps, setApps] = useState<Array<{ id: string; name: string }>>([]);
  const [types, setTypes] = useState<ObjectTypeSummary[]>([]);
  const [actions, setActions] = useState<Array<{ apiName: string }>>([]);
  const [err, setErr] = useState('');

  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [widgets, setWidgets] = useState<AppWidget[]>([]);
  const [wType, setWType] = useState('object-table');
  const [wObjectType, setWObjectType] = useState('');
  const [wAction, setWAction] = useState('');
  const [wTitle, setWTitle] = useState('');
  const [runObjects, setRunObjects] = useState<Record<string, Record<string, unknown>[]>>({});

  async function reload() { try { setApps((await api.listApps()).apps); } catch (e) { setErr((e as Error).message); } }
  useEffect(() => {
    reload();
    api.listObjectTypes().then((r) => { setTypes(r.objectTypes); if (r.objectTypes[0]) setWObjectType(r.objectTypes[0].apiName); }).catch(() => {});
    api.listActions().then((r) => { setActions(r.actions); if (r.actions[0]) setWAction(r.actions[0].apiName); }).catch(() => {});
  }, []);

  function startNew() { setEditId(null); setName(''); setWidgets([]); setErr(''); setMode('edit'); }
  async function startEdit(id: string) {
    setErr('');
    try { const app = await api.getApp(id); setEditId(app.id); setName(app.name); setWidgets(app.definition.widgets); setMode('edit'); }
    catch (e) { setErr((e as Error).message); }
  }
  function addWidget() {
    const config = wType === 'action-button' ? { action: wAction } : { objectType: wObjectType };
    const w: AppWidget = { id: newWidgetId(), type: wType, config };
    if (wTitle) w.title = wTitle;
    setWidgets((ws) => [...ws, w]); setWTitle('');
  }
  function removeWidget(id: string) { setWidgets((ws) => ws.filter((w) => w.id !== id)); }
  async function save() {
    setErr('');
    const definition: AppDefinition = { widgets };
    try {
      if (editId) await api.updateApp(editId, { name, definition }); else await api.createApp(name, definition);
      await reload(); setMode('list');
    } catch (e) { setErr((e as Error).message); }
  }
  async function remove(id: string) { setErr(''); try { await api.deleteApp(id); await reload(); } catch (e) { setErr((e as Error).message); } }
  async function run(id: string) {
    setErr('');
    try {
      const app = await api.getApp(id);
      setName(app.name); setWidgets(app.definition.widgets);
      const needed = Array.from(new Set(app.definition.widgets.filter((w) => w.type !== 'action-button').map((w) => String(w.config.objectType ?? '')).filter(Boolean)));
      const objects: Record<string, Record<string, unknown>[]> = {};
      for (const ot of needed) { try { objects[ot] = (await api.getObjects(ot)).objects; } catch { objects[ot] = []; } }
      setRunObjects(objects); setMode('run');
    } catch (e) { setErr((e as Error).message); }
  }
  async function onRunAction(action: string) {
    try { await api.executeAction(action, {}); window.alert(`Action ${action} executed`); }
    catch (e) { window.alert(`Action ${action}: ${(e as Error).message}`); }
  }

  if (mode === 'edit') {
    return (
      <div className="card">
        <h2>{editId ? 'Edit app' : 'New app'}</h2>
        <label htmlFor="appname">App name</label>
        <input id="appname" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ops Console" />
        <h3>Widgets</h3>
        {widgets.length === 0 ? <p style={{ color: 'var(--muted)' }}>No widgets yet.</p> : (
          <ul>{widgets.map((w) => <li key={w.id}>{w.title ?? w.type} <em>({w.type}: {String(w.config.objectType ?? w.config.action ?? '')})</em> <button className="sec" onClick={() => removeWidget(w.id)}>Remove</button></li>)}</ul>
        )}
        <div style={{ borderTop: '1px solid var(--line)', marginTop: 10, paddingTop: 10 }}>
          <label htmlFor="wtype">Add widget</label>
          <select id="wtype" value={wType} onChange={(e) => setWType(e.target.value)}>
            <option value="object-table">Object table</option>
            <option value="metric">Metric (count)</option>
            <option value="action-button">Action button</option>
          </select>
          {wType === 'action-button'
            ? <select aria-label="action" value={wAction} onChange={(e) => setWAction(e.target.value)}>{actions.map((a) => <option key={a.apiName} value={a.apiName}>{a.apiName}</option>)}</select>
            : <select aria-label="objectType" value={wObjectType} onChange={(e) => setWObjectType(e.target.value)}>{types.map((t) => <option key={t.apiName} value={t.apiName}>{t.apiName}</option>)}</select>}
          <input aria-label="widget title" value={wTitle} onChange={(e) => setWTitle(e.target.value)} placeholder="Title (optional)" />
          <button onClick={addWidget}>Add</button>
        </div>
        <div style={{ marginTop: 12 }}><button onClick={save}>Save app</button> <button className="sec" onClick={() => setMode('list')}>Cancel</button></div>
        {err ? <div className="err">{err}</div> : null}
      </div>
    );
  }

  if (mode === 'run') {
    return (
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><h2>{name}</h2><button className="sec" onClick={() => setMode('list')}>Back</button></div>
        <AppRuntime definition={{ widgets }} data={{ objects: runObjects, onRunAction }} />
        {err ? <div className="err">{err}</div> : null}
      </div>
    );
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><h2>Apps</h2><button onClick={startNew}>New app</button></div>
      {apps.length === 0 ? <p style={{ color: 'var(--muted)' }}>No apps yet. Build one!</p> : (
        <table><thead><tr><th>Name</th><th></th></tr></thead>
          <tbody>{apps.map((a) => <tr key={a.id}><td>{a.name}</td><td style={{ textAlign: 'right' }}>
            <button onClick={() => run(a.id)}>Run</button> <button className="sec" onClick={() => startEdit(a.id)}>Edit</button> <button className="sec" onClick={() => remove(a.id)}>Delete</button>
          </td></tr>)}</tbody>
        </table>
      )}
      {err ? <div className="err">{err}</div> : null}
    </div>
  );
}
