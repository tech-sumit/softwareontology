# Phase 28 (#4.2) — App Builder + Runtime UI Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps `- [ ]`.

**Goal:** A Workshop-like app builder in the web UI. Users compose **widgets** (object-table, metric, action-button) bound to ontology object types/actions, **save** the app (`@so/apps` from Plan 27), and **run** it — the runtime renders each widget against live data and wires action-buttons to action execution.

**Architecture:** A pure `AppRuntime` component (renders a definition given resolved data — testable in jsdom like `ObjectsTable`) + a stateful `AppsView` (list / builder / run modes, calls `api`). Add `@so/apps` endpoints to `api.ts`, wire a new **Apps** nav tab, register the module in `dev-server.mjs`. Follows existing apps/web patterns exactly.

**Tech:** React 18, Vite, Vitest + @testing-library/react (jsdom).

---

## Pre-flight
- [ ] **Branch:** `git checkout main && git checkout -b phase28/apps-ui`

---

## Task 1: API client + runtime + builder + wiring

**Files:** Modify `apps/web/src/api.ts`, `apps/web/src/App.tsx`, `apps/web/package.json`, `apps/web/dev-server.mjs`; Create `apps/web/src/components/AppRuntime.tsx`, `apps/web/src/components/AppRuntime.test.tsx`, `apps/web/src/views/AppsView.tsx`

- [ ] **Step 1: Add app types + endpoints — modify `apps/web/src/api.ts`**

After the existing `PropertyMeta` interface (near the top), add:
```ts
export interface AppWidget { id: string; type: string; title?: string; config: Record<string, unknown>; }
export interface AppDefinition { widgets: AppWidget[]; }
```
Inside the `api` object (after the `ask:` line), add:
```ts
  listApps: () => req<{ apps: Array<{ id: string; name: string }> }>('GET', '/apps'),
  getApp: (id: string) => req<{ id: string; name: string; definition: AppDefinition }>('GET', `/apps/${id}`),
  createApp: (name: string, definition: AppDefinition) => req<{ id: string }>('POST', '/apps', { name, definition }),
  updateApp: (id: string, body: { name?: string; definition?: AppDefinition }) => req<{ ok: boolean }>('PUT', `/apps/${id}`, body),
  deleteApp: (id: string) => req<{ ok: boolean }>('DELETE', `/apps/${id}`),
```

- [ ] **Step 2: Create `apps/web/src/components/AppRuntime.tsx`** (pure — the testable core)
```tsx
import { ObjectsTable } from './ObjectsTable';
import type { AppDefinition, AppWidget } from '../api';

export interface AppRuntimeData {
  objects: Record<string, Record<string, unknown>[]>;
  onRunAction: (action: string) => void;
}

function WidgetView({ widget, data }: { widget: AppWidget; data: AppRuntimeData }) {
  const title = widget.title ?? widget.type;
  if (widget.type === 'object-table') {
    const ot = String(widget.config.objectType ?? '');
    const rows = data.objects[ot] ?? [];
    const columns = rows.length > 0 ? Object.keys(rows[0]!) : [];
    return <div className="card"><h3>{title}</h3><ObjectsTable columns={columns} rows={rows} pk={columns[0] ?? ''} onSelect={() => {}} /></div>;
  }
  if (widget.type === 'metric') {
    const ot = String(widget.config.objectType ?? '');
    const count = (data.objects[ot] ?? []).length;
    return <div className="card"><h3>{title}</h3><div style={{ fontSize: 32, fontWeight: 700 }}>{count}</div></div>;
  }
  if (widget.type === 'action-button') {
    const action = String(widget.config.action ?? '');
    return <div className="card"><button onClick={() => data.onRunAction(action)}>{title}</button></div>;
  }
  return <div className="card">Unknown widget: {widget.type}</div>;
}

export function AppRuntime({ definition, data }: { definition: AppDefinition; data: AppRuntimeData }) {
  return <div className="app-runtime">{definition.widgets.map((w) => <WidgetView key={w.id} widget={w} data={data} />)}</div>;
}
```

- [ ] **Step 3: Create `apps/web/src/components/AppRuntime.test.tsx`**
```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AppRuntime } from './AppRuntime';
import type { AppDefinition } from '../api';

const definition: AppDefinition = { widgets: [
  { id: 'w1', type: 'object-table', title: 'Flights', config: { objectType: 'Flight' } },
  { id: 'w2', type: 'metric', title: 'Total flights', config: { objectType: 'Flight' } },
  { id: 'w3', type: 'action-button', title: 'Cancel', config: { action: 'cancelFlight' } },
] };
const objects = { Flight: [ { flightNumber: 'FL-1', status: 'Delayed' }, { flightNumber: 'FL-2', status: 'Boarding' } ] };

describe('AppRuntime', () => {
  it('renders table rows, a metric count, and a working action button', () => {
    const onRunAction = vi.fn();
    render(<AppRuntime definition={definition} data={{ objects, onRunAction }} />);
    expect(screen.getByText('FL-1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument(); // metric = 2 flights (unique text node)
    fireEvent.click(screen.getByText('Cancel'));
    expect(onRunAction).toHaveBeenCalledWith('cancelFlight');
  });

  it('shows the empty state when there are no objects for the type', () => {
    render(<AppRuntime definition={{ widgets: [{ id: 'w1', type: 'object-table', config: { objectType: 'Ghost' } }] }} data={{ objects: {}, onRunAction: () => {} }} />);
    expect(screen.getByText(/no objects/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run the runtime test → PASS:** `pnpm --filter @so/web test -- AppRuntime` (timeout 120000). Expected: 2 passed.

- [ ] **Step 5: Create `apps/web/src/views/AppsView.tsx`** (stateful builder + runner)
```tsx
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
        {widgets.length === 0 ? <p style={{ color: '#8a929c' }}>No widgets yet.</p> : (
          <ul>{widgets.map((w) => <li key={w.id}>{w.title ?? w.type} <em>({w.type}: {String(w.config.objectType ?? w.config.action ?? '')})</em> <button className="sec" onClick={() => removeWidget(w.id)}>Remove</button></li>)}</ul>
        )}
        <div style={{ borderTop: '1px solid #2a2f37', marginTop: 10, paddingTop: 10 }}>
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
      {apps.length === 0 ? <p style={{ color: '#8a929c' }}>No apps yet. Build one!</p> : (
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
```

- [ ] **Step 6: Wire the nav — modify `apps/web/src/App.tsx`**

Add the import (with the other view imports): `import { AppsView } from './views/AppsView';`
Extend the `View` union: `type View = 'setup' | 'explorer' | 'admin' | 'dashboards' | 'ask' | 'apps';`
Add a tab (after the `ask` tab): `<div className={`tab ${view === 'apps' ? 'active' : ''}`} onClick={() => setView('apps')}>Apps</div>`
Add to the view switch (before the final `: <ExplorerView .../>`): `: view === 'apps' ? <AppsView />`

- [ ] **Step 7: Register the module — modify `apps/web/dev-server.mjs`**

Add the import (with the others): `import apps from '@so/apps';`
Add `apps` to the `modules: [...]` array (append at the end).

- [ ] **Step 8: Add the workspace dep — modify `apps/web/package.json`**

Add to `devDependencies`: `"@so/apps": "workspace:*",` (keep JSON valid). Then run `pnpm install`.

- [ ] **Step 9: Verify the web package — typecheck, test, build:**
```
pnpm --filter @so/web typecheck            # exit 0
pnpm --filter @so/web test                 # all web tests pass (existing + AppRuntime)
pnpm --filter @so/web build                # vite build succeeds
```
(timeout 180000). If eslint flags `window`/`alert` as `no-undef`, the apps/web config already enables browser globals — `window.alert` is used. If `Date.now()` is flagged, it is NOT (the Date restriction applies only to workflow scripts, not app code). No unused imports.

- [ ] **Step 10: Commit:** `git add -A && git commit -m "feat(web): app builder + runtime UI (Apps tab)"`

---

## Task 2: Full verification + merge
- [ ] `pnpm run infra:up && pnpm run infra:seed && pnpm typecheck; pnpm lint; pnpm test` (exit codes) → green (includes the new AppRuntime test). `git checkout main && git merge --ff-only phase28/apps-ui`

---

## Self-review
- **User #4 (app builder), UI** — builder composes object-table/metric/action-button widgets bound to ontology types/actions, saves to `@so/apps`, runs them against live data, fires actions. New **Apps** nav tab; module registered in dev-server. ✓
- **Testable in the green suite** — `AppRuntime` is a pure component (props in, DOM out) tested with @testing-library/react: rows render, metric counts, action-button fires. Matches the `ObjectsTable.test.tsx` pattern. ✓
- **Pattern-consistent** — flat `api` methods; `card`/`tab`/`err` classes; stateful view like `DashboardsView`; no new deps beyond the `@so/apps` workspace link. ✓
- **Deferred (backlog):** drag-and-drop layout/grid positioning, action parameter forms (run mode calls actions with `{}` — surfaces the action's own validation), more widget types (charts, filters, forms, markdown), inter-widget wiring (selection → filter), app publish/versioning, per-widget permissions. Flagged.
