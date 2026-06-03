# Phase 51 — Project Creation Journey Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps `- [ ]`.

**Goal:** Replace the `window.prompt` "new project" with a **proper creation journey**: a polished modal (name + description), and a **"Get started" guide** on an empty project's Overview (next-step cards: upload & model → pipeline → connector → app). Adds a `description` to projects.

**Architecture:** Small backend add (`projects.description`); `api.createProject(name, description)`; a pure `CreateProjectModal` (jsdom-tested); `App` opens it from every "New project" affordance; `ProjectOverview` shows getting-started when the project is empty.

---

## Pre-flight
- [ ] **Branch:** `git checkout main && git checkout -b phase51/project-journey`

---

## Task 1: Backend — project description (`@so/projects`)

**Files:** Modify `packages/projects/src/migrate.ts`, `packages/projects/src/service.ts`, `packages/projects/src/routes.ts`

- [ ] **Step 1: `migrate.ts`** — append to `MIGRATIONS`: `` `ALTER TABLE projects ADD COLUMN IF NOT EXISTS description text` ``.
- [ ] **Step 2: `service.ts`** — `createProject(orgId, name, description?: string)`: INSERT `description`; `listProjects`/`getProject` SELECT + return `description` (type `Project { id; name; description?: string }`).
- [ ] **Step 3: `routes.ts`** — `POST /` reads `{ name, description }`; pass `description` to `createProject`.
- [ ] **Step 4: Run → PASS:** `pnpm run infra:up && pnpm --filter @so/projects test` (existing test stays green — adding a nullable column + optional field is backward-compatible). typecheck clean.
- [ ] **Step 5: Commit:** `git add -A && git commit -m "feat(projects): optional project description"`

---

## Task 2: API + `CreateProjectModal` (+ test)

**Files:** Modify `apps/web/src/api.ts`; Create `apps/web/src/components/CreateProjectModal.tsx` (+ `.test.tsx`)

- [ ] **Step 1: `api.ts`** — replace `createProject` and widen project types to carry `description`:
```ts
  listProjects: () => req<{ projects: Array<{ id: string; name: string; description?: string }> }>('GET', '/projects'),
  createProject: (name: string, description = '') => req<{ id: string }>('POST', '/projects', { name, description }),
```

- [ ] **Step 2: `components/CreateProjectModal.tsx`**
```tsx
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
```

- [ ] **Step 3: `components/CreateProjectModal.test.tsx`**
```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { CreateProjectModal } from './CreateProjectModal';
describe('CreateProjectModal', () => {
  it('requires a name, then creates', () => {
    const onCreate = vi.fn();
    render(<CreateProjectModal onCreate={onCreate} onClose={() => {}} />);
    fireEvent.click(screen.getByText('Create project'));
    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByText(/name is required/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('project name'), { target: { value: 'Marketing' } });
    fireEvent.click(screen.getByText('Create project'));
    expect(onCreate).toHaveBeenCalledWith('Marketing', '');
  });
});
```

- [ ] **Step 4: Run → PASS:** `pnpm --filter @so/web test -- CreateProjectModal` (timeout 120000).

---

## Task 3: Wire the modal + getting-started

**Files:** Modify `apps/web/src/App.tsx`, `apps/web/src/views/ProjectOverview.tsx`, `apps/web/src/styles.css`

- [ ] **Step 1: `App.tsx`** — add `showCreate` state. Change `newProject()` to `setShowCreate(true)` (drop the `window.prompt`). Add the modal at the root of the authenticated return:
```tsx
{showCreate ? <CreateProjectModal onClose={() => setShowCreate(false)} onCreate={async (name, description) => { try { const { id } = await api.createProject(name, description); setProjects((await api.listProjects()).projects); setShowCreate(false); openProject(id); } catch { setShowCreate(false); } }} /> : null}
```
(Import `CreateProjectModal`. The rail `onNewProject`, the Console "New project" card, and ConsoleHome's `onNewProject` all already call `newProject` → now they open the modal.)

- [ ] **Step 2: `ProjectOverview.tsx`** — when the project is empty (`c.datasets === 0 && c.pipelines === 0 && c.apps === 0`), render a **Get started** card ABOVE the KPI grid:
```tsx
{c.datasets === 0 && c.pipelines === 0 && c.apps === 0 ? (
  <div className="card pad" style={{ marginBottom: 18 }}>
    <h3>Get started in {projectName}</h3>
    <p className="muted">This project is empty. A typical flow:</p>
    <div className="grid tiles">
      <div className="card tile" onClick={() => onGo('setup')}><div className="ti">↥</div><div className="tn">1 · Upload &amp; model</div><div className="td">Upload a CSV and turn it into an object type.</div></div>
      <div className="card tile" onClick={() => onGo('pipelines')}><div className="ti">⑂</div><div className="tn">2 · Build a pipeline</div><div className="td">Transform data with SQL or a multi-step DAG.</div></div>
      <div className="card tile" onClick={() => onGo('connectors')}><div className="ti">⇄</div><div className="tn">3 · Connect a source</div><div className="td">Pull from Postgres, S3, REST, or Airflow.</div></div>
      <div className="card tile" onClick={() => onGo('apps')}><div className="ti">▥</div><div className="tn">4 · Build an app</div><div className="td">Compose widgets over your objects.</div></div>
    </div>
  </div>
) : null}
```
(Keep the KPI grid + activity below.)

- [ ] **Step 3: `styles.css`** — append modal styles:
```css
.modal-backdrop{position:fixed;inset:0;background:rgba(8,12,22,.5);display:flex;align-items:center;justify-content:center;z-index:50}
.modal{background:var(--panel);border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow-lg);padding:24px;width:460px;max-width:92vw}
.modal h2{margin-top:0}
```

- [ ] **Step 4: Verify:** `pnpm --filter @so/web typecheck` (0); `pnpm --filter @so/web test` (all pass incl. CreateProjectModal); `pnpm --filter @so/web build`. No unused imports; no `eslint-disable react-hooks/exhaustive-deps`.

- [ ] **Step 5: Commit:** `git add -A && git commit -m "feat(web): project creation modal + empty-project getting-started"`

---

## Task 4: Full verification + merge (GATED)
- [ ] `pnpm run infra:up && pnpm run infra:seed && pnpm typecheck; pnpm lint`; then `pnpm test >/tmp/v.log 2>&1; t=$?; grep -E "Tests +[0-9]+ (passed|failed)" /tmp/v.log | tail -1`. **Only if tc/lint/`t` all 0**: `git checkout main && git merge --ff-only phase51/project-journey`. (Flaky env: re-run on mass timeouts / `ERR_IPC_CHANNEL_CLOSED`; ensure Docker up.)

---

## Self-review
- **Proper journey** — a real modal (name + description, validated) replaces the prompt; new projects land in an Overview that **guides** the next steps when empty. ✓
- **Description** — projects carry an optional description (backward-compatible column). ✓
- **Testable** — pure `CreateProjectModal` jsdom-tested (validation + create). ✓
- **Deferred → Plan 52:** per-page help/how-to. Project rename/delete; project members. Flagged.
