import { useEffect, useState } from 'react';
import { api, getActiveBranch } from '../api';
import { BranchDiff, type Edit, type Create } from '../components/BranchDiff';
export function BranchesView({ notify, onChanged }: { notify: (m: string, k?: 'ok' | 'err') => void; onChanged: () => void }) {
  const [branches, setBranches] = useState<Array<{ name: string; status: string; createdAt: string | null }>>([]);
  const [name, setName] = useState('');
  const [sel, setSel] = useState('');
  const [diff, setDiff] = useState<{ edits: Edit[]; creates: Create[] } | null>(null);
  const active = getActiveBranch();
  async function reload() { try { setBranches((await api.listBranches()).branches); } catch (e) { notify((e as Error).message, 'err'); } }
  useEffect(() => { reload(); }, []);
  useEffect(() => { if (sel && sel !== 'main') { api.branchDiff(sel).then(setDiff).catch(() => setDiff(null)); } else setDiff(null); }, [sel]);
  async function create() { if (!name.trim()) return; try { await api.createBranch(name.trim()); notify('Branch created.'); setName(''); await reload(); onChanged(); } catch (e) { notify((e as Error).message, 'err'); } }
  async function merge() { try { const r = await api.mergeBranch(sel); notify(`Merged ${r.merged} change(s) into main.`); setSel(''); await reload(); onChanged(); } catch (e) { notify((e as Error).message, 'err'); } }
  async function discard() { if (!window.confirm(`Discard branch “${sel}” and its changes?`)) return; try { await api.deleteBranch(sel); notify('Branch discarded.'); setSel(''); await reload(); onChanged(); } catch (e) { notify((e as Error).message, 'err'); } }
  async function remove(b: string) { if (!window.confirm(`Delete merged branch “${b}”?`)) return; try { await api.deleteBranch(b); notify('Branch deleted.'); if (sel === b) setSel(''); await reload(); onChanged(); } catch (e) { notify((e as Error).message, 'err'); } }
  return (
    <div className="card pad">
      <h2>Branches</h2>
      <p className="muted">Branches isolate edits made through Actions on top of the shared base data. Switch to a branch (top bar) to work on it, then merge it into main here.</p>
      <div style={{ display: 'flex', gap: 8, margin: '12px 0' }}>
        <input aria-label="branch name" value={name} onChange={(e) => setName(e.target.value)} placeholder="feature-x" />
        <button onClick={create}>Create branch</button>
      </div>
      <table><thead><tr><th>Branch</th><th>Status</th><th>Created</th><th /></tr></thead>
        <tbody>{branches.map((b) => (
          <tr key={b.name} className={b.name === active ? 'sel' : ''}>
            <td><strong>{b.name}</strong>{b.name === active ? <span className="muted"> (active)</span> : null}</td>
            <td>{b.name === 'main' ? 'default' : b.status}</td>
            <td>{b.createdAt ? new Date(b.createdAt).toLocaleString() : '—'}</td>
            <td>
              {b.name !== 'main' && b.status !== 'merged' ? <button className="sec" onClick={() => setSel(b.name)}>Review</button> : null}
              {b.name !== 'main' && b.status === 'merged' ? <button className="sec" onClick={() => remove(b.name)}>Delete</button> : null}
            </td>
          </tr>
        ))}</tbody>
      </table>
      {sel && sel !== 'main' ? (
        <div style={{ marginTop: 16 }}>
          <h3>Changes on {sel}</h3>
          {diff ? <BranchDiff edits={diff.edits} creates={diff.creates} /> : <p className="muted">Loading…</p>}
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}><button onClick={merge}>Merge into main</button><button className="sec" onClick={discard}>Discard</button></div>
        </div>
      ) : null}
    </div>
  );
}
