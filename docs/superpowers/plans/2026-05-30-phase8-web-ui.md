# Phase 8 — Web UI (the demoable slice) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A real, clickable web app (`apps/web`, Vite + React + TS) that drives the Phase-1 slice end-to-end: log in → upload a CSV → model it as an Object Type → browse resolved objects in an Object Explorer → open an object → run an Action and watch the value change. Served by `@so/server` in production; `pnpm dev` runs it for the demo.

**Scope decision (YAGNI):** This builds a direct React app, NOT the spec's `@so/ui-shell` dynamic module-UI-contribution system. A plugin-style UI loader is premature with one UI surface; we'll extract `@so/ui-shell` when a second module needs to contribute UI. The app calls the existing REST APIs.

**Architecture:** `apps/web` has a typed `api` client (fetch with `credentials:'include'` for the session cookie), an auth gate, and three views — **Setup** (upload CSV + define object type), **Explorer** (object-type sidebar + objects table + detail panel with action buttons). Presentational pieces (`ObjectsTable`, `LoginForm`) are pure and unit-tested under jsdom. `@so/server` gains static-file serving (via `@fastify/static`) to serve the built UI.

**Tech Stack:** Vite 6, React 18, TypeScript, Vitest + jsdom + @testing-library/react for component tests; `@fastify/static` for serving.

---

## Pre-flight

- [ ] **Branch:** `cd /Users/sumitagrawal/CODE/sumit/SoftwareOntology && git checkout main && git checkout -b phase8/web-ui`

---

## File structure

```
apps/web/
  package.json        react, react-dom, vite, @vitejs/plugin-react ; dev: vitest jsdom @testing-library/* @types/react*
  tsconfig.json       jsx: react-jsx
  vite.config.ts      react plugin + dev proxy /api -> :3000
  vitest.config.ts    environment jsdom + setup
  test-setup.ts       @testing-library/jest-dom
  index.html
  src/main.tsx
  src/styles.css
  src/api.ts          typed API client
  src/App.tsx         auth gate + view switch + nav
  src/components/LoginForm.tsx     (pure: onSubmit)
  src/components/ObjectsTable.tsx  (pure: columns + rows)
  src/views/SetupView.tsx          upload CSV + define object type
  src/views/ExplorerView.tsx       sidebar + table + detail + run action
  src/components/LoginForm.test.tsx
  src/components/ObjectsTable.test.tsx
vitest.config.ts      (modified) add 'apps/*' to projects
packages/server/      (modified) optional static serving of UI_DIST
package.json          (modified) add `dev` + ensure `build` covers web
```

---

## Task 1: `apps/web` scaffold + API client + workspace wiring

**Files:** Create `apps/web/{package.json,tsconfig.json,vite.config.ts,vitest.config.ts,test-setup.ts,index.html,src/main.tsx,src/styles.css,src/api.ts}`; Modify root `vitest.config.ts`

- [ ] **Step 1: `apps/web/package.json`**

```json
{
  "name": "@so/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": { "react": "^18.3.1", "react-dom": "^18.3.1" },
  "devDependencies": {
    "vite": "^6.0.0",
    "@vitejs/plugin-react": "^4.3.4",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0",
    "jsdom": "^25.0.0",
    "@testing-library/react": "^16.1.0",
    "@testing-library/jest-dom": "^6.6.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0"
  }
}
```

- [ ] **Step 2: `pnpm install`**

- [ ] **Step 3: `apps/web/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": ["node", "vitest/globals", "@testing-library/jest-dom"],
    "outDir": "dist",
    "noEmit": true
  },
  "include": ["src/**/*", "test-setup.ts", "vite.config.ts", "vitest.config.ts"]
}
```

> **IMPORTANT — Vite/bundler resolution, not NodeNext.** This `tsconfig` overrides the base's `NodeNext` with `Bundler` resolution. Therefore **all relative imports in `apps/web` must be EXTENSIONLESS** — write `./App`, `../api`, `./components/LoginForm` (NOT `./App.js`). The code blocks below show `.js` only for visual consistency with the rest of the repo; when you create these files, **drop the `.js`** on every relative import. Keep real-extension imports like `./styles.css`. (`@so/*` package imports are unaffected.)

- [ ] **Step 4: `apps/web/vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:3000' } },
  build: { outDir: 'dist' },
});
```

- [ ] **Step 5: `apps/web/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: { environment: 'jsdom', globals: true, setupFiles: ['./test-setup.ts'] },
});
```

- [ ] **Step 6: `apps/web/test-setup.ts`**

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 7: `apps/web/index.html`**

```html
<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>SoftwareOntology</title></head>
  <body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>
</html>
```

- [ ] **Step 8: `apps/web/src/api.ts`**

```ts
export interface User { id: string; orgId: string; email: string; permissions: string[]; }
export interface ObjectTypeSummary { apiName: string; primaryKey: string; }
export interface PropertyMeta { apiName: string; type: string; }

async function req<T>(method: string, path: string, body?: unknown, asText = false): Promise<T> {
  const init: RequestInit = { method, credentials: 'include' };
  if (body !== undefined) {
    init.headers = { 'content-type': asText ? 'text/csv' : 'application/json' };
    init.body = asText ? (body as string) : JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, init);
  if (!res.ok) {
    const msg = await res.json().then((j) => j.error).catch(() => `HTTP ${res.status}`);
    throw new Error(msg);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const api = {
  login: (email: string, password: string) => req<{ ok: boolean }>('POST', '/auth/login', { email, password }),
  logout: () => req<{ ok: boolean }>('POST', '/auth/logout'),
  me: () => req<{ user: User }>('GET', '/auth/me'),
  uploadCsv: (name: string, csv: string) =>
    req<{ dataset: { id: string } }>('POST', `/datasets?name=${encodeURIComponent(name)}&format=csv`, csv, true),
  listObjectTypes: () => req<{ objectTypes: ObjectTypeSummary[] }>('GET', '/ontology/object-types'),
  getObjectType: (n: string) =>
    req<{ objectType: { apiName: string; primaryKey: string; properties: PropertyMeta[] } }>('GET', `/ontology/object-types/${n}`),
  createObjectType: (body: unknown) => req<{ objectType: unknown }>('POST', '/ontology/object-types', body),
  getObjects: (n: string) => req<{ objects: Record<string, unknown>[] }>('GET', `/ontology/object-types/${n}/objects`),
  listActions: () => req<{ actions: Array<{ apiName: string; objectType: string; kind: string }> }>('GET', '/actions/definitions'),
  createAction: (body: unknown) => req<{ ok: boolean }>('POST', '/actions/definitions', body),
  executeAction: (apiName: string, body: unknown) => req<{ ok: boolean }>('POST', `/actions/${apiName}/execute`, body),
};
```

- [ ] **Step 9: `apps/web/src/styles.css`**

```css
* { box-sizing: border-box; }
body { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; color: #1b1f24; background: #f5f7f9; }
.nav { display: flex; gap: 16px; align-items: center; background: #15233f; color: #cdd8e4; padding: 10px 16px; }
.nav b { color: #fff; } .nav button { margin-left: auto; }
.tabs { display: flex; gap: 8px; padding: 10px 16px; }
.tab { padding: 6px 12px; border: 1px solid #d0d7de; border-radius: 6px; background: #fff; cursor: pointer; }
.tab.active { background: #e8f0fe; border-color: #4a7fd4; color: #16335f; font-weight: 600; }
.wrap { padding: 16px; } .row { display: flex; gap: 16px; }
.side { width: 200px; } .side .ot { padding: 8px 10px; border-radius: 6px; cursor: pointer; }
.side .ot.active { background: #e8f0fe; font-weight: 600; }
.main { flex: 1; }
table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #eef1f4; font-size: 14px; }
th { background: #f0f2f5; color: #54606e; } tr.sel { background: #fffbe6; }
.detail { width: 320px; background: #fff; border-radius: 8px; padding: 14px; }
.detail .k { color: #8a929c; font-size: 12px; } .detail .v { font-weight: 600; margin-bottom: 8px; }
button { padding: 6px 12px; border: 1px solid #15233f; background: #15233f; color: #fff; border-radius: 6px; cursor: pointer; }
button.sec { background: #fff; color: #15233f; }
input, textarea, select { padding: 6px 8px; border: 1px solid #d0d7de; border-radius: 6px; font: inherit; width: 100%; }
label { display: block; font-size: 13px; color: #54606e; margin: 8px 0 4px; }
.card { background: #fff; border-radius: 8px; padding: 16px; max-width: 520px; }
.err { color: #b03030; font-size: 13px; margin-top: 8px; }
```

- [ ] **Step 10: `apps/web/src/main.tsx`**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>,
);
```

- [ ] **Step 11: Modify root `vitest.config.ts` to include apps**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*'],
  },
});
```

- [ ] **Step 12: Typecheck deferred** (App.tsx not yet created — comes in Task 2). Commit the scaffold.

```bash
git add -A && git commit -m "feat(web): apps/web scaffold (vite+react) + typed API client"
```

---

## Task 2: Auth gate, Login, Setup view

**Files:** Create `apps/web/src/App.tsx`, `apps/web/src/components/LoginForm.tsx`, `apps/web/src/views/SetupView.tsx`, `apps/web/src/components/LoginForm.test.tsx`

- [ ] **Step 1: `apps/web/src/components/LoginForm.tsx`** (pure, testable)

```tsx
import { useState } from 'react';

export function LoginForm({ onSubmit, error }: { onSubmit: (email: string, password: string) => void; error?: string }) {
  const [email, setEmail] = useState('admin@example.com');
  const [password, setPassword] = useState('admin');
  return (
    <form className="card" onSubmit={(e) => { e.preventDefault(); onSubmit(email, password); }}>
      <h2>Sign in</h2>
      <label htmlFor="email">Email</label>
      <input id="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <label htmlFor="password">Password</label>
      <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <div style={{ marginTop: 12 }}><button type="submit">Sign in</button></div>
      {error ? <div className="err" role="alert">{error}</div> : null}
    </form>
  );
}
```

- [ ] **Step 2: `apps/web/src/components/LoginForm.test.tsx`**

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { LoginForm } from './LoginForm.js';

describe('LoginForm', () => {
  it('submits the entered credentials', () => {
    const onSubmit = vi.fn();
    render(<LoginForm onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(onSubmit).toHaveBeenCalledWith('admin@example.com', 'admin');
  });

  it('shows an error when provided', () => {
    render(<LoginForm onSubmit={() => {}} error="invalid credentials" />);
    expect(screen.getByRole('alert')).toHaveTextContent('invalid credentials');
  });
});
```

- [ ] **Step 3: `apps/web/src/views/SetupView.tsx`**

```tsx
import { useState } from 'react';
import { api } from '../api.js';

export function SetupView({ onModeled }: { onModeled: () => void }) {
  const [csv, setCsv] = useState('flight_no,status,seats\nFL-204,Delayed,189\nFL-118,Boarding,142\n');
  const [name, setName] = useState('flights');
  const [otName, setOtName] = useState('Flight');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  async function run() {
    setErr(''); setMsg('');
    try {
      const { dataset } = await api.uploadCsv(name, csv);
      await api.createObjectType({
        apiName: otName, datasetId: dataset.id, primaryKey: 'flightNumber',
        properties: [
          { apiName: 'flightNumber', column: 'flight_no', type: 'string' },
          { apiName: 'status', column: 'status', type: 'string' },
          { apiName: 'seats', column: 'seats', type: 'int' },
        ],
      });
      setMsg(`Modeled "${otName}" from dataset "${name}".`);
      onModeled();
    } catch (e) { setErr((e as Error).message); }
  }

  return (
    <div className="card">
      <h2>Upload &amp; model</h2>
      <label htmlFor="dsname">Dataset name</label>
      <input id="dsname" value={name} onChange={(e) => setName(e.target.value)} />
      <label htmlFor="csv">CSV</label>
      <textarea id="csv" rows={6} value={csv} onChange={(e) => setCsv(e.target.value)} />
      <label htmlFor="ot">Object type name</label>
      <input id="ot" value={otName} onChange={(e) => setOtName(e.target.value)} />
      <p style={{ fontSize: 12, color: '#8a929c' }}>Maps flight_no→flightNumber, status→status, seats→seats (int).</p>
      <button onClick={run}>Upload &amp; model</button>
      {msg ? <div style={{ color: '#1e7a44', marginTop: 8 }}>{msg}</div> : null}
      {err ? <div className="err">{err}</div> : null}
    </div>
  );
}
```

- [ ] **Step 4: `apps/web/src/App.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { api, type User } from './api.js';
import { LoginForm } from './components/LoginForm.js';
import { SetupView } from './views/SetupView.js';
import { ExplorerView } from './views/ExplorerView.js';

type View = 'setup' | 'explorer';

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loginErr, setLoginErr] = useState('');
  const [view, setView] = useState<View>('explorer');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => { api.me().then((r) => setUser(r.user)).catch(() => setUser(null)); }, []);

  async function doLogin(email: string, password: string) {
    setLoginErr('');
    try { await api.login(email, password); setUser((await api.me()).user); }
    catch (e) { setLoginErr((e as Error).message); }
  }
  async function doLogout() { await api.logout().catch(() => {}); setUser(null); }

  if (!user) return <div className="wrap"><LoginForm onSubmit={doLogin} error={loginErr} /></div>;

  return (
    <>
      <div className="nav"><b>◳ SoftwareOntology</b><span>{user.email}</span><button className="sec" onClick={doLogout}>Sign out</button></div>
      <div className="tabs">
        <div className={`tab ${view === 'explorer' ? 'active' : ''}`} onClick={() => setView('explorer')}>Explorer</div>
        <div className={`tab ${view === 'setup' ? 'active' : ''}`} onClick={() => setView('setup')}>Upload &amp; model</div>
      </div>
      <div className="wrap">
        {view === 'setup'
          ? <SetupView onModeled={() => { setRefreshKey((k) => k + 1); setView('explorer'); }} />
          : <ExplorerView key={refreshKey} />}
      </div>
    </>
  );
}
```

- [ ] **Step 5: Run the LoginForm test → PASS** (ExplorerView referenced by App but created in Task 3 — typecheck deferred to Task 3; the component test for LoginForm is isolated and passes now):

```bash
pnpm --filter @so/web test LoginForm
```
Expected: 2 tests pass.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(web): auth gate, login form, upload+model setup view"
```

---

## Task 3: Explorer view (sidebar + table + detail + run action)

**Files:** Create `apps/web/src/components/ObjectsTable.tsx`, `apps/web/src/views/ExplorerView.tsx`, `apps/web/src/components/ObjectsTable.test.tsx`

- [ ] **Step 1: `apps/web/src/components/ObjectsTable.tsx`** (pure, testable)

```tsx
export function ObjectsTable({
  columns, rows, pk, selected, onSelect,
}: {
  columns: string[];
  rows: Record<string, unknown>[];
  pk: string;
  selected?: string;
  onSelect: (id: string) => void;
}) {
  if (rows.length === 0) return <p style={{ color: '#8a929c' }}>No objects.</p>;
  return (
    <table>
      <thead><tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
      <tbody>
        {rows.map((r) => {
          const id = String(r[pk]);
          return (
            <tr key={id} className={selected === id ? 'sel' : ''} onClick={() => onSelect(id)} style={{ cursor: 'pointer' }}>
              {columns.map((c) => <td key={c}>{r[c] === null || r[c] === undefined ? '' : String(r[c])}</td>)}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 2: `apps/web/src/components/ObjectsTable.test.tsx`**

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ObjectsTable } from './ObjectsTable.js';

const rows = [
  { flightNumber: 'FL-204', status: 'Delayed' },
  { flightNumber: 'FL-118', status: 'Boarding' },
];

describe('ObjectsTable', () => {
  it('renders a row per object and calls onSelect with the pk', () => {
    const onSelect = vi.fn();
    render(<ObjectsTable columns={['flightNumber', 'status']} rows={rows} pk="flightNumber" onSelect={onSelect} />);
    expect(screen.getByText('FL-204')).toBeInTheDocument();
    expect(screen.getByText('Delayed')).toBeInTheDocument();
    fireEvent.click(screen.getByText('FL-118'));
    expect(onSelect).toHaveBeenCalledWith('FL-118');
  });

  it('shows an empty state', () => {
    render(<ObjectsTable columns={['x']} rows={[]} pk="x" onSelect={() => {}} />);
    expect(screen.getByText(/no objects/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: `apps/web/src/views/ExplorerView.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { api, type ObjectTypeSummary, type PropertyMeta } from '../api.js';
import { ObjectsTable } from '../components/ObjectsTable.js';

export function ExplorerView() {
  const [types, setTypes] = useState<ObjectTypeSummary[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [props, setProps] = useState<PropertyMeta[]>([]);
  const [pk, setPk] = useState('');
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [err, setErr] = useState('');

  useEffect(() => { api.listObjectTypes().then((r) => setTypes(r.objectTypes)).catch((e) => setErr(e.message)); }, []);
  useEffect(() => { if (types[0] && !active) setActive(types[0].apiName); }, [types, active]);

  useEffect(() => {
    if (!active) return;
    setSelected(undefined);
    void (async () => {
      try {
        const ot = await api.getObjectType(active);
        setProps(ot.objectType.properties); setPk(ot.objectType.primaryKey);
        setRows((await api.getObjects(active)).objects);
      } catch (e) { setErr((e as Error).message); }
    })();
  }, [active]);

  const columns = props.map((p) => p.apiName);
  const current = rows.find((r) => String(r[pk]) === selected);

  async function runStatusAction(value: string) {
    if (!active || !current) return;
    setErr('');
    try {
      // ensure a 'setStatus' modify action exists for this type, then execute it
      const defs = (await api.listActions()).actions;
      if (!defs.some((d) => d.apiName === `set_${active}_status`)) {
        await api.createAction({ apiName: `set_${active}_status`, objectType: active, kind: 'modify' });
      }
      await api.executeAction(`set_${active}_status`, { primaryKey: String(current[pk]), edits: { status: value } });
      setRows((await api.getObjects(active)).objects);
    } catch (e) { setErr((e as Error).message); }
  }

  if (types.length === 0) return <p style={{ color: '#8a929c' }}>No object types yet — use “Upload &amp; model”.</p>;

  return (
    <div className="row">
      <div className="side">
        <div className="label">OBJECT TYPES</div>
        {types.map((t) => (
          <div key={t.apiName} className={`ot ${active === t.apiName ? 'active' : ''}`} onClick={() => setActive(t.apiName)}>{t.apiName}</div>
        ))}
      </div>
      <div className="main">
        <ObjectsTable columns={columns} rows={rows} pk={pk} selected={selected} onSelect={setSelected} />
        {err ? <div className="err">{err}</div> : null}
      </div>
      {current ? (
        <div className="detail">
          <h3 style={{ marginTop: 0 }}>{String(current[pk])}</h3>
          {columns.map((c) => (<div key={c}><div className="k">{c}</div><div className="v">{String(current[c] ?? '')}</div></div>))}
          {props.some((p) => p.apiName === 'status') ? (
            <div style={{ marginTop: 12 }}>
              <div className="label">ACTIONS</div>
              <button onClick={() => runStatusAction('Cancelled')}>Set status: Cancelled</button>{' '}
              <button className="sec" onClick={() => runStatusAction('On time')}>Set status: On time</button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Typecheck + run web tests → PASS**

```bash
pnpm --filter @so/web run typecheck
pnpm --filter @so/web test
```
Expected: typecheck clean (App/ExplorerView now resolve); 4 component tests pass (LoginForm 2 + ObjectsTable 2).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(web): object explorer — type sidebar, objects table, detail + run-action"
```

---

## Task 4: Serve the built UI from `@so/server` + dev script

**Files:** Modify `packages/server/package.json`, `packages/server/src/server.ts`, root `package.json`

- [ ] **Step 1: Add `@fastify/static` dep — `packages/server/package.json`**

Add `"@fastify/static": "^8.0.0"` to dependencies; `pnpm install`.

- [ ] **Step 2: Serve UI_DIST when set — modify `packages/server/src/server.ts`**

Add import:
```ts
import fastifyStatic from '@fastify/static';
```
After the module routes are registered (after the `for (const m of opts.modules)` loop) and before the error handler, add:
```ts
  const uiDist = config.get('UI_DIST');
  if (uiDist) {
    await app.register(fastifyStatic, { root: uiDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.raw.url?.startsWith('/api')) return reply.code(404).send({ error: 'not found' });
      return reply.sendFile('index.html'); // SPA fallback
    });
  }
```

- [ ] **Step 3: Add root scripts — modify root `package.json`**

Ensure `scripts` includes:
```json
    "dev": "concurrently -n server,web -c blue,green \"pnpm --filter @so/server... exec echo 'start your dev server entrypoint here'\" \"pnpm --filter @so/web dev\"",
```
NOTE: there is no standalone server entrypoint binary yet (the server is a library consumed by tests). For the demo, document the manual path instead — add this script:
```json
    "dev:web": "pnpm --filter @so/web dev"
```
and a README note: run a small bootstrap (below) for the API, and `pnpm dev:web` for the UI (Vite proxies `/api` → :3000).

- [ ] **Step 4: Create a demo bootstrap — `apps/web/dev-server.mjs`** (a tiny script that starts the API with all modules, for the demo)

```js
// Run the full API for local UI development: `node apps/web/dev-server.mjs`
import { createServer, createConfig } from '@so/server';
import { createLogger } from '@so/observability';
import auth from '@so/auth';
import datasets from '@so/datasets';
import ontology from '@so/ontology';
import actions from '@so/actions';

const server = await createServer({
  modules: [auth, datasets, ontology, actions],
  logger: createLogger(),
  config: createConfig(),
});
const addr = await server.start(3000);
createLogger().info(`API listening at ${addr}`);
```

Add to `apps/web/package.json` devDependencies the workspace API packages so the script resolves them:
```json
    "@so/server": "workspace:*", "@so/observability": "workspace:*",
    "@so/auth": "workspace:*", "@so/datasets": "workspace:*",
    "@so/ontology": "workspace:*", "@so/actions": "workspace:*"
```
Then `pnpm install`. Document in the commit: API = `DATABASE_URL=... S3_* ... node apps/web/dev-server.mjs` (after `pnpm infra:up`), UI = `pnpm dev:web`.

- [ ] **Step 5: Verify server still builds/tests**

```bash
pnpm run infra:up
pnpm --filter @so/server test && pnpm --filter @so/server run typecheck
```
Expected: server's 6 tests still pass (static serving is gated on UI_DIST, unset in tests); typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(server,web): static UI serving (UI_DIST) + demo dev bootstrap"
```

---

## Task 5: Full verification + manual demo + merge

- [ ] **Step 1: Full suite**

```bash
pnpm run infra:up && pnpm run infra:seed
pnpm typecheck && pnpm lint && pnpm test
```
Expected: typecheck + lint clean; **49 tests** (prior 45 + web 4). The web project now runs under jsdom in the root suite.

- [ ] **Step 2: Build the UI**

```bash
pnpm --filter @so/web build
```
Expected: `apps/web/dist` produced with no errors.

- [ ] **Step 3: Manual demo (optional but recommended)**

```bash
# terminal 1: API
pnpm run infra:up && pnpm run infra:seed
DATABASE_URL=postgresql://so:so@localhost:5432/so S3_ENDPOINT=localhost:9000 \
  S3_ACCESS_KEY_ID=minioadmin S3_SECRET_ACCESS_KEY=minioadmin S3_BUCKET=so-datasets \
  pnpm dev:api
# terminal 2: UI
pnpm dev:web   # open the printed localhost URL; sign in admin@example.com / admin
```
Flow: sign in → “Upload & model” → Explorer shows the Flight objects → click FL-204 → “Set status: Cancelled” → the table updates.

- [ ] **Step 4: Merge**

```bash
git checkout main && git merge --ff-only phase8/web-ui
```

---

## Done criteria

- `apps/web` is a working Vite/React app: login gate, upload+model view, and an Object Explorer (type sidebar, objects table, detail panel) that runs actions and reflects the change.
- Pure components (`LoginForm`, `ObjectsTable`) are unit-tested under jsdom; the root suite runs them.
- `@so/server` can serve the built UI (`UI_DIST`); a dev bootstrap + Vite proxy enable the local demo.
- Full suite green; `apps/web` builds.

Plan 9 (`module-admin`) adds the ontology-manager / user-admin UI + APIs, completing Phase 1.

---

## Self-review (against the spec)

- **Spec §6/§10 (apps & UI)** — Object Explorer (type list, objects table, detail + actions) + an upload/model view; matches the brainstorming mockups' structure. ✓
- **Spec §8/§9 (no CDN, air-gap)** — hand-written CSS, bundled fonts (system stack), no external CDN; served by the app's own server. ✓
- **Placeholder scan** — complete code; Task 4 Step 3's dev script is intentionally documented as manual (no server bin yet) with a real bootstrap provided. ✓
- **Type consistency** — `api` client types (`User`/`ObjectTypeSummary`/`PropertyMeta`) shared across `App`/`SetupView`/`ExplorerView`; `ObjectsTable`/`LoginForm` props match their tests. ✓
- **Deliberately deferred (explicit):** the `@so/ui-shell` package + dynamic module-UI-contribution system (build a real app first; extract when a 2nd UI module appears); a packaged server CLI/bin (dev bootstrap script used for now); filters/pagination UI, link traversal in the UI, Playwright e2e (component tests + backend integration tests cover correctness; manual demo covers the click-through). Flagged, not silent.
```
