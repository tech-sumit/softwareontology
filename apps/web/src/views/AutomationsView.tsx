import { useEffect, useState } from 'react';
import { api } from '../api';

export function AutomationsView() {
  const [automations, setAutomations] = useState<Array<{ id: string; name: string; triggerAction: string; thenAction: string }>>([]);
  const [name, setName] = useState('');
  const [triggerAction, setTriggerAction] = useState('');
  const [thenAction, setThenAction] = useState('');
  const [thenEdits, setThenEdits] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  async function reload() { try { setAutomations((await api.listAutomations()).automations); } catch (e) { setErr((e as Error).message); } }
  useEffect(() => { void reload(); }, []);

  async function create() {
    setErr(''); setMsg('');
    let edits: Record<string, unknown> | undefined;
    if (thenEdits.trim()) {
      try { edits = JSON.parse(thenEdits) as Record<string, unknown>; }
      catch { setErr('then-edits must be valid JSON'); return; }
    }
    try {
      await api.createAutomation({ name, triggerAction, thenAction, ...(edits ? { thenEdits: edits } : {}) });
      setName(''); setTriggerAction(''); setThenAction(''); setThenEdits(''); await reload(); setMsg('Automation created.');
    } catch (e) { setErr((e as Error).message); }
  }

  return (
    <div className="card">
      <h2>Automations</h2>
      <p style={{ color: 'var(--muted)' }}>Run a follow-up action whenever a trigger action fires.</p>
      {automations.length === 0 ? <p style={{ color: 'var(--muted)' }}>None yet.</p> : (
        <table>
          <thead><tr><th>Name</th><th>Trigger</th><th>Then</th></tr></thead>
          <tbody>{automations.map((a) => <tr key={a.id}><td>{a.name}</td><td>{a.triggerAction}</td><td>{a.thenAction}</td></tr>)}</tbody>
        </table>
      )}

      <div style={{ borderTop: '1px solid var(--line)', marginTop: 16, paddingTop: 12 }}>
        <h3>New automation</h3>
        <label htmlFor="au-name">Name</label> <input id="au-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="on_order_close" />
        <label htmlFor="au-trigger"> Trigger action</label> <input id="au-trigger" value={triggerAction} onChange={(e) => setTriggerAction(e.target.value)} placeholder="closeOrder" />
        <label htmlFor="au-then"> Then action</label> <input id="au-then" value={thenAction} onChange={(e) => setThenAction(e.target.value)} placeholder="notifyOwner" />
        <div style={{ marginTop: 8 }}>
          <label htmlFor="au-edits">Then-edits (optional JSON)</label>{' '}
          <input id="au-edits" value={thenEdits} onChange={(e) => setThenEdits(e.target.value)} placeholder='{"status":"notified"}' style={{ width: 280 }} />
        </div>
        <div style={{ marginTop: 10 }}><button onClick={create}>Create automation</button></div>
      </div>
      {msg ? <div style={{ color: '#3fb950', marginTop: 8 }}>{msg}</div> : null}
      {err ? <div className="err">{err}</div> : null}
    </div>
  );
}
