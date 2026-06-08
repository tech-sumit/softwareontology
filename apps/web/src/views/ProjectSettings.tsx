import { useState } from 'react';
import { api } from '../api';
export function ProjectSettings({ project, isDefault, onSaved, onArchived, notify }: {
  project: { id: string; name: string; description?: string };
  isDefault: boolean;
  onSaved: () => void;
  onArchived: () => void;
  notify: (message: string, kind?: 'ok' | 'err') => void;
}) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? '');
  async function save() {
    try { await api.updateProject(project.id, { name: name.trim(), description: description.trim() }); notify('Project updated.'); onSaved(); }
    catch (e) { notify((e as Error).message, 'err'); }
  }
  async function archive() {
    if (!window.confirm(`Archive “${project.name}”? Its data is kept and you can restore it from the Console.`)) return;
    try { await api.archiveProject(project.id); notify('Project archived.'); onArchived(); }
    catch (e) { notify((e as Error).message, 'err'); }
  }
  return (
    <div className="card pad" style={{ maxWidth: 580 }}>
      <h2>Project settings</h2>
      <label htmlFor="ps-name">Name</label>
      <input id="ps-name" aria-label="project name" value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%' }} />
      <label htmlFor="ps-desc">Description</label>
      <textarea id="ps-desc" aria-label="project description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} style={{ width: '100%' }} />
      <div style={{ marginTop: 14 }}><button onClick={save}>Save changes</button></div>
      <hr style={{ margin: '22px 0', border: 0, borderTop: '1px solid var(--line)' }} />
      <h3 style={{ color: 'var(--bad)' }}>Danger zone</h3>
      {isDefault
        ? <p className="muted">The Default project can’t be archived.</p>
        : <><p className="muted">Archiving hides the project from the workspace; its data is preserved and you can restore it from the Console.</p><button className="sec" onClick={archive}>Archive project</button></>}
    </div>
  );
}
