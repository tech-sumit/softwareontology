import { useEffect, useState } from 'react';
import { api } from '../api';
import { MembersTable, type MemberRow } from '../components/MembersTable';
export function ProjectSettings({ project, isDefault, role, onSaved, onArchived, notify }: {
  project: { id: string; name: string; description?: string };
  isDefault: boolean;
  role?: 'owner' | 'editor' | 'viewer' | 'admin' | undefined;
  onSaved: () => void;
  onArchived: () => void;
  notify: (message: string, kind?: 'ok' | 'err') => void;
}) {
  const canManage = role === 'owner' || role === 'admin';
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? '');
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [candidates, setCandidates] = useState<Array<{ id: string; email: string }>>([]);
  const [addUser, setAddUser] = useState('');
  const [addRole, setAddRole] = useState('viewer');
  async function reloadMembers() {
    try { setMembers((await api.listMembers(project.id)).members); } catch { /* ignore */ }
    if (canManage) { try { const c = (await api.listProjectCandidates(project.id)).users; setCandidates(c); setAddUser(c[0]?.id ?? ''); } catch { /* ignore */ } }
  }
  useEffect(() => { reloadMembers(); }, [project.id]);
  async function save() { try { await api.updateProject(project.id, { name: name.trim(), description: description.trim() }); notify('Project updated.'); onSaved(); } catch (e) { notify((e as Error).message, 'err'); } }
  async function archive() { if (!window.confirm(`Archive “${project.name}”? Its data is kept and you can restore it from the Console.`)) return; try { await api.archiveProject(project.id); notify('Project archived.'); onArchived(); } catch (e) { notify((e as Error).message, 'err'); } }
  async function changeRole(userId: string, r: string) { try { await api.setMemberRole(project.id, userId, r); notify('Role updated.'); reloadMembers(); } catch (e) { notify((e as Error).message, 'err'); } }
  async function remove(userId: string) { try { await api.removeMember(project.id, userId); notify('Member removed.'); reloadMembers(); } catch (e) { notify((e as Error).message, 'err'); } }
  async function add() { if (!addUser) return; try { await api.addMember(project.id, addUser, addRole); notify('Member added.'); reloadMembers(); } catch (e) { notify((e as Error).message, 'err'); } }
  return (
    <div className="card pad" style={{ maxWidth: 640 }}>
      <h2>Project settings</h2>
      {canManage ? (
        <>
          <label htmlFor="ps-name">Name</label>
          <input id="ps-name" aria-label="project name" value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%' }} />
          <label htmlFor="ps-desc">Description</label>
          <textarea id="ps-desc" aria-label="project description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} style={{ width: '100%' }} />
          <div style={{ marginTop: 14 }}><button onClick={save}>Save changes</button></div>
        </>
      ) : <p className="muted">You have <strong>{role ?? 'no'}</strong> access to this project. Ask an owner to make changes.</p>}

      <hr style={{ margin: '22px 0', border: 0, borderTop: '1px solid var(--line)' }} />
      <h3>Members</h3>
      <MembersTable members={members} canManage={canManage} onChangeRole={changeRole} onRemove={remove} />
      {canManage ? (
        <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
          <select aria-label="add user" value={addUser} onChange={(e) => setAddUser(e.target.value)}>{candidates.map((u) => <option key={u.id} value={u.id}>{u.email}</option>)}</select>
          <select aria-label="add role" value={addRole} onChange={(e) => setAddRole(e.target.value)}>{['viewer', 'editor', 'owner'].map((r) => <option key={r} value={r}>{r}</option>)}</select>
          <button onClick={add} disabled={!addUser}>Add member</button>
        </div>
      ) : null}

      {canManage ? (
        <>
          <hr style={{ margin: '22px 0', border: 0, borderTop: '1px solid var(--line)' }} />
          <h3 style={{ color: 'var(--bad)' }}>Danger zone</h3>
          {isDefault ? <p className="muted">The Default project can’t be archived.</p>
            : <><p className="muted">Archiving hides the project from the workspace; its data is preserved and you can restore it from the Console.</p><button className="sec" onClick={archive}>Archive project</button></>}
        </>
      ) : null}
    </div>
  );
}
