import { useEffect, useState } from 'react';
import { api } from '../api';
import { MarkingsTable } from '../components/MarkingsTable';

type Named = { id: string; name: string };

export function GovernanceView() {
  const [markings, setMarkings] = useState<Named[]>([]);
  const [datasets, setDatasets] = useState<Named[]>([]);
  const [roles, setRoles] = useState<Named[]>([]);
  const [clearances, setClearances] = useState<Named[]>([]);
  const [name, setName] = useState('');
  const [mkSel, setMkSel] = useState('');
  const [dsSel, setDsSel] = useState('');
  const [roleSel, setRoleSel] = useState('');
  const [mkDatasets, setMkDatasets] = useState<Array<{ datasetId: string; name: string }>>([]);
  const [mkRoles, setMkRoles] = useState<Array<{ roleId: string; name: string }>>([]);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  async function reload() {
    try {
      const [m, d, r, c] = await Promise.all([api.listMarkings(), api.listDatasets(), api.listRoles(), api.myClearances()]);
      setMarkings(m.markings); setDatasets(d.datasets); setRoles(r.roles); setClearances(c.clearances);
      if (!mkSel && m.markings[0]) setMkSel(m.markings[0].id);
      if (!dsSel && d.datasets[0]) setDsSel(d.datasets[0].id);
      if (!roleSel && r.roles[0]) setRoleSel(r.roles[0].id);
    } catch (e) { setErr((e as Error).message); }
  }
  useEffect(() => { reload(); }, []);

  async function loadReadback(markingId: string) {
    if (!markingId) { setMkDatasets([]); setMkRoles([]); return; }
    try {
      const [ds, rs] = await Promise.all([api.markingDatasets(markingId), api.markingRoles(markingId)]);
      setMkDatasets(ds.datasets); setMkRoles(rs.roles);
    } catch (e) { setErr((e as Error).message); }
  }
  useEffect(() => { void loadReadback(mkSel); }, [mkSel]);

  async function create() { setErr(''); setMsg(''); try { await api.createMarking(name); setName(''); await reload(); setMsg('Marking created.'); } catch (e) { setErr((e as Error).message); } }
  async function apply() { setErr(''); setMsg(''); try { await api.applyMarking(mkSel, dsSel); await loadReadback(mkSel); setMsg('Marking applied to dataset.'); } catch (e) { setErr((e as Error).message); } }
  async function grant() { setErr(''); setMsg(''); try { await api.grantMarking(mkSel, roleSel); await reload(); await loadReadback(mkSel); setMsg('Clearance granted to role.'); } catch (e) { setErr((e as Error).message); } }
  async function unmark(datasetId: string, dsName: string) {
    if (!window.confirm(`Remove this marking from dataset “${dsName}”?`)) return;
    setErr(''); setMsg('');
    try { await api.unmarkDataset(mkSel, datasetId); await loadReadback(mkSel); setMsg('Marking removed from dataset.'); } catch (e) { setErr((e as Error).message); }
  }
  async function revoke(roleId: string, roleName: string) {
    if (!window.confirm(`Revoke this clearance from role “${roleName}”?`)) return;
    setErr(''); setMsg('');
    try { await api.revokeMarking(mkSel, roleId); await reload(); await loadReadback(mkSel); setMsg('Clearance revoked from role.'); } catch (e) { setErr((e as Error).message); }
  }

  const clearedIds = new Set(clearances.map((c) => c.id));
  return (
    <div className="card">
      <h2>Governance — markings &amp; clearances</h2>
      <p style={{ color: 'var(--muted)' }}>Markings are mandatory: reading a marked dataset requires clearance for every marking on it (not bypassed by admin). Derived datasets inherit their sources' markings.</p>

      <h3>Markings</h3>
      <MarkingsTable markings={markings} clearedIds={clearedIds} />
      <div style={{ margin: '10px 0' }}>
        <input aria-label="new marking" value={name} onChange={(e) => setName(e.target.value)} placeholder="PII / SECRET / …" />
        <button onClick={create}>Create marking</button>
      </div>

      <h3>Apply a marking to a dataset</h3>
      <select aria-label="apply marking" value={mkSel} onChange={(e) => setMkSel(e.target.value)}>{markings.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
      <select aria-label="dataset" value={dsSel} onChange={(e) => setDsSel(e.target.value)}>{datasets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
      <button onClick={apply}>Apply</button>

      <h3>Grant clearance to a role</h3>
      <select aria-label="grant marking" value={mkSel} onChange={(e) => setMkSel(e.target.value)}>{markings.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
      <select aria-label="role" value={roleSel} onChange={(e) => setRoleSel(e.target.value)}>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
      <button onClick={grant}>Grant</button>

      {mkSel ? (
        <div style={{ marginTop: 16 }}>
          <h3>Where “{markings.find((m) => m.id === mkSel)?.name ?? mkSel}” is used</h3>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 260 }}>
              <h4>Datasets with this marking</h4>
              {mkDatasets.length === 0 ? <p style={{ color: 'var(--muted)' }}>None.</p> : (
                <table>
                  <thead><tr><th>Dataset</th><th /></tr></thead>
                  <tbody>{mkDatasets.map((d) => (
                    <tr key={d.datasetId}><td>{d.name}</td><td><button className="sec" onClick={() => unmark(d.datasetId, d.name)}>Remove</button></td></tr>
                  ))}</tbody>
                </table>
              )}
            </div>
            <div style={{ minWidth: 260 }}>
              <h4>Roles cleared</h4>
              {mkRoles.length === 0 ? <p style={{ color: 'var(--muted)' }}>None.</p> : (
                <table>
                  <thead><tr><th>Role</th><th /></tr></thead>
                  <tbody>{mkRoles.map((r) => (
                    <tr key={r.roleId}><td>{r.name}</td><td><button className="sec" onClick={() => revoke(r.roleId, r.name)}>Revoke</button></td></tr>
                  ))}</tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {msg ? <div style={{ color: '#3fb950', marginTop: 10 }}>{msg}</div> : null}
      {err ? <div className="err">{err}</div> : null}
    </div>
  );
}
