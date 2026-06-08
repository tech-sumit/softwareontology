# Phase 53 — Project Lifecycle (Rename · Archive · Settings · Toasts) Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps `- [ ]`.

**Goal:** Finish the projects feature: **rename** a project, **edit its description**, **archive/restore** it (data preserved), via a new project **Settings** surface and a Console **Archived** section — with a reusable **global toast** for action feedback.

**Architecture:** Backend `projects` gains `archived` + `updateProject`/`setArchived`/`listArchivedProjects` (Default project can't be archived; `listProjects` hides archived). `api.ts` gains the verbs. UI: a pure jsdom-tested `Toast` driven by App-level `notify`; a `ProjectSettings` view (rename/description/archive); Console shows archived projects with Restore; a help entry for the new surface.

---

## Pre-flight
- [ ] **Branch:** `git checkout main && git checkout -b phase53/project-lifecycle`

---

## Task 1: Backend — archive + update (`@so/projects`)

**Files:** Modify `packages/projects/src/migrate.ts`, `packages/projects/src/service.ts`, `packages/projects/src/routes.ts`, `packages/projects/test/projects.int.test.ts`

- [ ] **Step 1: `migrate.ts`** — append to `MIGRATIONS` (after the description ALTER):
```ts
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false`,
```

- [ ] **Step 2: `service.ts`** — change `listProjects` to hide archived, and add three functions; export them. Replace the `listProjects` body and add the new functions before `return`:
```ts
  async function listProjects(orgId: string): Promise<Project[]> {
    return ctx.db.query<Project>(`SELECT id, name, description FROM projects WHERE org_id = $1 AND archived = false ORDER BY (id = 'project_default') DESC, name`, [orgId]);
  }

  async function listArchivedProjects(orgId: string): Promise<Project[]> {
    return ctx.db.query<Project>(`SELECT id, name, description FROM projects WHERE org_id = $1 AND archived = true ORDER BY name`, [orgId]);
  }

  async function updateProject(orgId: string, id: string, patch: { name?: string; description?: string }): Promise<Project | null> {
    if (patch.name !== undefined && (!patch.name || !NAME_RE.test(patch.name))) throw new Error('invalid project name');
    const sets: string[] = []; const vals: unknown[] = [];
    if (patch.name !== undefined) { vals.push(patch.name); sets.push(`name = $${vals.length}`); }
    if (patch.description !== undefined) { vals.push(patch.description); sets.push(`description = $${vals.length}`); }
    if (sets.length === 0) return getProject(orgId, id);
    vals.push(orgId); const orgIdx = vals.length;
    vals.push(id); const idIdx = vals.length;
    const rows = await ctx.db.query<Project>(`UPDATE projects SET ${sets.join(', ')} WHERE org_id = $${orgIdx} AND id = $${idIdx} RETURNING id, name, description`, vals);
    return rows[0] ?? null;
  }

  async function setArchived(orgId: string, id: string, archived: boolean): Promise<boolean> {
    if (id === 'project_default') throw new Error('the Default project cannot be archived');
    const rows = await ctx.db.query<{ id: string }>(`UPDATE projects SET archived = $1 WHERE org_id = $2 AND id = $3 RETURNING id`, [archived, orgId, id]);
    return Boolean(rows[0]);
  }
```
  And widen the return: `return { createProject, listProjects, getProject, listArchivedProjects, updateProject, setArchived };`

- [ ] **Step 3: `routes.ts`** — add routes (place `GET /archived` and the `:id` sub-routes; Fastify matches the static `/archived` before `/:id`). Insert after the existing `GET /:id` handler, before the closing `};`:
```ts
  fastify.get('/archived', { preHandler: requirePermission('projects:read') }, async (req) => ({ projects: await svc.listArchivedProjects(req.user!.orgId) }));

  fastify.patch('/:id', { preHandler: requirePermission('projects:write') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as { name?: string; description?: string };
    try { const p = await svc.updateProject(req.user!.orgId, id, b); return p ? reply.send(p) : reply.code(404).send({ error: 'project not found' }); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  fastify.post('/:id/archive', { preHandler: requirePermission('projects:write') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try { const ok = await svc.setArchived(req.user!.orgId, id, true); return ok ? reply.send({ ok: true }) : reply.code(404).send({ error: 'project not found' }); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  fastify.post('/:id/restore', { preHandler: requirePermission('projects:write') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try { const ok = await svc.setArchived(req.user!.orgId, id, false); return ok ? reply.send({ ok: true }) : reply.code(404).send({ error: 'project not found' }); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });
```

- [ ] **Step 4: Add a test** — append a second `it(...)` inside the existing `describe` in `projects.int.test.ts` (server is already started by the first test; reuse the login pattern):
```ts
  it('renames, archives (hiding from list), and restores — but never the Default', async () => {
    await server.kernel.ctx.db.query(`DELETE FROM projects WHERE name IN ('Lifecycle','Lifecycle2')`);
    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const a = { cookie: cookieFrom(login.headers['set-cookie']) };

    const id = (await server.app.inject({ method: 'POST', url: '/api/projects', headers: a, payload: { name: 'Lifecycle' } })).json().id;

    // rename + describe
    const patched = await server.app.inject({ method: 'PATCH', url: `/api/projects/${id}`, headers: a, payload: { name: 'Lifecycle2', description: 'desc' } });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().name).toBe('Lifecycle2');
    expect(patched.json().description).toBe('desc');

    // archive → gone from list, present in archived
    expect((await server.app.inject({ method: 'POST', url: `/api/projects/${id}/archive`, headers: a })).statusCode).toBe(200);
    const listed = (await server.app.inject({ method: 'GET', url: '/api/projects', headers: a })).json().projects as Array<{ id: string }>;
    expect(listed.some((p) => p.id === id)).toBe(false);
    const archived = (await server.app.inject({ method: 'GET', url: '/api/projects/archived', headers: a })).json().projects as Array<{ id: string }>;
    expect(archived.some((p) => p.id === id)).toBe(true);

    // restore → back in list
    expect((await server.app.inject({ method: 'POST', url: `/api/projects/${id}/restore`, headers: a })).statusCode).toBe(200);
    const relisted = (await server.app.inject({ method: 'GET', url: '/api/projects', headers: a })).json().projects as Array<{ id: string }>;
    expect(relisted.some((p) => p.id === id)).toBe(true);

    // Default cannot be archived
    expect((await server.app.inject({ method: 'POST', url: '/api/projects/project_default/archive', headers: a })).statusCode).toBe(400);
  });
```

- [ ] **Step 5: Run → PASS:** `pnpm run infra:up && pnpm --filter @so/projects test` (timeout 120000; both tests green). typecheck clean.
- [ ] **Step 6: Commit:** `git add -A && git commit -m "feat(projects): rename, archive/restore, hide-archived" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"`

---

## Task 2: API verbs

**Files:** Modify `apps/web/src/api.ts`

- [ ] **Step 1** — after the existing `createProject` line, add:
```ts
  updateProject: (id: string, patch: { name?: string; description?: string }) => req<{ id: string; name: string; description?: string }>('PATCH', `/projects/${id}`, patch),
  archiveProject: (id: string) => req<{ ok: boolean }>('POST', `/projects/${id}/archive`),
  restoreProject: (id: string) => req<{ ok: boolean }>('POST', `/projects/${id}/restore`),
  listArchivedProjects: () => req<{ projects: Array<{ id: string; name: string; description?: string }> }>('GET', '/projects/archived'),
```

---

## Task 3: Global `Toast` (+ test)

**Files:** Create `apps/web/src/components/Toast.tsx`, `apps/web/src/components/Toast.test.tsx`

- [ ] **Step 1: `Toast.tsx`**
```tsx
export function Toast({ message, kind = 'ok', onClose }: { message: string; kind?: 'ok' | 'err'; onClose: () => void }) {
  return (
    <div className={kind === 'err' ? 'toast toast-err' : 'toast'} role="status">
      <span>{message}</span>
      <button className="toast-x" aria-label="dismiss" onClick={onClose}>×</button>
    </div>
  );
}
```

- [ ] **Step 2: `Toast.test.tsx`**
```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Toast } from './Toast';
describe('Toast', () => {
  it('shows the message and dismisses', () => {
    const onClose = vi.fn();
    render(<Toast message="Project updated." onClose={onClose} />);
    expect(screen.getByText('Project updated.')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('dismiss'));
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run → PASS:** `pnpm --filter @so/web test` (timeout 120000).

---

## Task 4: `ProjectSettings` view + help entry

**Files:** Create `apps/web/src/views/ProjectSettings.tsx`; Modify `apps/web/src/help.ts`

- [ ] **Step 1: `ProjectSettings.tsx`**
```tsx
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
```

- [ ] **Step 2: `help.ts`** — add a `'project:settings'` entry to `HELP`:
```ts
  'project:settings': { title: 'project settings', steps: [
    'Rename the project or edit its description, then click “Save changes”.',
    'Archiving hides a project from the workspace but preserves all its data.',
    'Restore an archived project anytime from the Console’s Archived section.',
    'The Default project cannot be archived.',
  ]},
```

---

## Task 5: Wire into `App` + Console Archived section

**Files:** Modify `apps/web/src/App.tsx`, `apps/web/src/views/ConsoleHome.tsx`, `apps/web/src/styles.css`

- [ ] **Step 1: `App.tsx` imports** — add:
```tsx
import { Toast } from './components/Toast';
import { ProjectSettings } from './views/ProjectSettings';
```
- [ ] **Step 2: `App.tsx` PROJECT_ITEMS** — append a Settings item to the `PROJECT_ITEMS` array:
```tsx
  { id: 'settings', label: 'Settings', icon: '⚙' },
```
- [ ] **Step 3: `App.tsx` state + helpers** — add state near the others:
```tsx
  const [archived, setArchived] = useState<Array<{ id: string; name: string; description?: string }>>([]);
  const [toast, setToast] = useState<{ message: string; kind: 'ok' | 'err' } | null>(null);
```
  Add a `notify` + auto-dismiss effect + a `reloadProjects` helper (place after the existing functions like `newProject`):
```tsx
  function notify(message: string, kind: 'ok' | 'err' = 'ok') { setToast({ message, kind }); }
  async function reloadProjects() { try { const [r, ar] = await Promise.all([api.listProjects(), api.listArchivedProjects()]); setProjects(r.projects); setArchived(ar.projects); } catch { /* ignore */ } }
```
  Add this effect next to the other `useEffect`s (must be ABOVE the `if (!user) return ...` early return):
```tsx
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t); }, [toast]);
```
- [ ] **Step 4: `App.tsx`** — change the projects-loading effect to also load archived. Replace the existing `useEffect(() => { if (user) api.listProjects()...` line with:
```tsx
  useEffect(() => { if (user) Promise.all([api.listProjects(), api.listArchivedProjects()]).then(([r, ar]) => { setProjects(r.projects); setArchived(ar.projects); const def = r.projects.find((p) => p.id === 'project_default') ?? r.projects[0]; if (def) { setProject(def.id); setActiveProject(def.id); } }).catch(() => {}); }, [user]);
```
- [ ] **Step 5: `App.tsx`** — add the `settings` case in the PROJECT (non-console) `switch (view)` block, before `default:`:
```tsx
      case 'settings': { const cur = projects.find((p) => p.id === project) ?? { id: project, name: projName }; return <ProjectSettings project={cur} isDefault={project === 'project_default'} onSaved={() => reloadProjects()} onArchived={() => { openConsole(); reloadProjects(); }} notify={notify} />; }
```
- [ ] **Step 6: `App.tsx`** — pass archived + restore to ConsoleHome. Change the console `default:` return to:
```tsx
        default: return <ConsoleHome projects={projects} archivedProjects={archived} onOpenProject={openProject} onNewProject={newProject} onOpenSurface={openSurface} onRestoreProject={async (id) => { try { await api.restoreProject(id); notify('Project restored.'); reloadProjects(); } catch (e) { notify((e as Error).message, 'err'); } }} />;
```
- [ ] **Step 7: `App.tsx`** — render the toast at the app root. Add just before the final `</div>` of the `return` (next to the `showCreate` modal line):
```tsx
      {toast ? <Toast message={toast.message} kind={toast.kind} onClose={() => setToast(null)} /> : null}
```

- [ ] **Step 8: `ConsoleHome.tsx`** — widen the signature and render an Archived section. Change the props type to:
```tsx
export function ConsoleHome({ projects, archivedProjects, onOpenProject, onNewProject, onOpenSurface, onRestoreProject }: {
  projects: Array<{ id: string; name: string }>; archivedProjects: Array<{ id: string; name: string }>; onOpenProject: (id: string) => void; onNewProject: () => void; onOpenSurface: (id: string) => void; onRestoreProject: (id: string) => void;
}) {
```
  And insert this block right after the closing `</div>` of the `Projects` `.sec` (before the `Shared · Platform` section):
```tsx
      {archivedProjects.length > 0 ? (
        <div className="sec"><h3>Archived</h3>
          <div className="grid pcards">
            {archivedProjects.map((p) => (
              <div key={p.id} className="card pcard" style={{ opacity: 0.65 }}>
                <div className="ph"><div className="pdot" style={{ background: colorFor(p.id) }}>{p.name.slice(0, 1).toUpperCase()}</div><div className="pn">{p.name}</div></div>
                <button className="sec" style={{ marginTop: 6 }} onClick={() => onRestoreProject(p.id)}>Restore</button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
```

- [ ] **Step 9: `styles.css`** — append toast styles:
```css
.toast{position:fixed;bottom:22px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:14px;background:var(--ink);color:#fff;padding:11px 16px;border-radius:10px;box-shadow:var(--shadow-lg);z-index:60;font-size:13.5px;font-weight:500}
.toast-err{background:var(--bad)}
.toast-x{background:transparent;border:0;color:#fff;font-size:18px;line-height:1;cursor:pointer;padding:0}
```

- [ ] **Step 10: Verify:** `pnpm --filter @so/web typecheck` (0); `pnpm --filter @so/web test` (all pass incl. Toast); `pnpm --filter @so/web build`. No unused imports; no `eslint-disable react-hooks/exhaustive-deps`.
- [ ] **Step 11: Commit:** `git add -A && git commit -m "feat(web): project settings (rename/archive), Console archived restore, global toasts" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"`

---

## Task 6: Full verification + merge (GATED)
- [ ] Run:
```bash
cd /Users/sumitagrawal/CODE/sumit/SoftwareOntology
pnpm run infra:up && pnpm run infra:seed
pnpm typecheck; tc=$?
pnpm lint; lint=$?
pnpm test >/tmp/p53.log 2>&1; t=$?
grep -E "Tests +[0-9]+ (passed|failed)" /tmp/p53.log | tail -1
echo "tc=$tc lint=$lint t=$t"
if [ $tc -eq 0 ] && [ $lint -eq 0 ] && [ $t -eq 0 ]; then git checkout main && git merge --ff-only phase53/project-lifecycle && echo MERGED; else echo "NOT MERGING"; fi
```
(Flaky env: re-run on mass ~60000ms timeouts / `ERR_IPC_CHANNEL_CLOSED`; ensure `docker info` works first.)

---

## Self-review
- **Rename + description** — Settings view → `PATCH /projects/:id` → list/rail/breadcrumb refresh via `reloadProjects`. ✓
- **Archive/restore** — `archived` column; `listProjects` hides archived; Console shows an Archived section with Restore; Default is protected (backend 400 + UI copy). ✓
- **Feedback** — reusable jsdom-tested `Toast` via App `notify`, auto-dismiss. ✓
- **Help** — new `project:settings` entry so the Settings surface gets a how-to panel (Plan 52 mechanism). ✓
- **Tested** — backend lifecycle test (rename/archive/hide/restore/Default-guard); `Toast` component test. ✓
- **Deferred (flagged):** per-project **members/roles** = a real access-control design decision (projects are currently a scoping layer over org-wide RBAC, not a permission boundary) — its own next step. Richer action-parameter forms belong to the ontology/actions area, not project lifecycle.
