import { useState } from 'react';
export function CreateProjectModal({ onCreate, onClose }: { onCreate: (name: string, description: string) => void; onClose: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [err, setErr] = useState('');
  function submit() { if (!name.trim()) { setErr('Project name is required'); return; } onCreate(name.trim(), description.trim()); }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>New project</h2>
        <p className="muted" style={{ marginTop: -4 }}>A project is a workspace for its datasets, pipelines, connectors and apps. The ontology stays shared org-wide.</p>
        <label htmlFor="np-name">Name</label>
        <input id="np-name" aria-label="project name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Marketing Analytics" style={{ width: '100%' }} autoFocus />
        <label htmlFor="np-desc">Description <span className="muted">(optional)</span></label>
        <textarea id="np-desc" aria-label="project description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} style={{ width: '100%' }} placeholder="What this project is for" />
        {err ? <div className="err">{err}</div> : null}
        <div style={{ marginTop: 14, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="sec" onClick={onClose}>Cancel</button>
          <button onClick={submit}>Create project</button>
        </div>
      </div>
    </div>
  );
}
