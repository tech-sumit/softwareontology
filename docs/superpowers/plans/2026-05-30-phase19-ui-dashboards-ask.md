# Phase 19 (3/4 UI) — Web UI: Dashboards + Ask Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps `- [ ]`.

**Goal:** Surface the new backend capabilities in `apps/web`: a **Dashboards** tab (group-by → bar chart) and an **Ask** tab (AIP). Load all modules in the dev bootstrap so the full API is available for the demo.

**Architecture:** Additive to `apps/web` (Vite/React, EXTENSIONLESS imports). New pure `BarList` component (tested), `DashboardsView`, `AskView`; two `api` methods; two App tabs. `apps/web/dev-server.mjs` loads every module.

---

## Pre-flight
- [ ] **Branch:** `git checkout main && git checkout -b phase19/ui-dashboards-ask`

---

## Task 1: API client + components + views + tabs + bootstrap

**Files:** Modify `apps/web/src/api.ts`, `apps/web/src/App.tsx`, `apps/web/dev-server.mjs`; Create `apps/web/src/components/BarList.tsx`, `apps/web/src/components/BarList.test.tsx`, `apps/web/src/views/DashboardsView.tsx`, `apps/web/src/views/AskView.tsx`

> Reminder: `apps/web` uses bundler resolution — **extensionless relative imports** (`../api`, `./components/BarList`).

- [ ] **Step 1: Extend the API client — modify `apps/web/src/api.ts`** (add after `createUser`)
```ts
  aggregate: (objectType: string, groupBy: string) => req<{ buckets: Array<{ group: string; count: number }> }>('POST', '/dashboards/aggregate', { objectType, groupBy }),
  ask: (objectType: string, question: string) => req<{ answer: string }>('POST', '/aip/ask', { objectType, question }),
```

- [ ] **Step 2: Create `apps/web/src/components/BarList.tsx`** (pure)
```tsx
export function BarList({ buckets }: { buckets: Array<{ group: string; count: number }> }) {
  if (buckets.length === 0) return <p style={{ color: '#8a929c' }}>No data.</p>;
  const max = Math.max(...buckets.map((b) => b.count), 1);
  return (
    <div>
      {buckets.map((b) => (
        <div key={b.group} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0' }}>
          <div style={{ width: 140, fontSize: 13 }}>{b.group}</div>
          <div style={{ height: 18, width: `${Math.round((b.count / max) * 280)}px`, background: '#4a7fd4', borderRadius: 4 }} />
          <div style={{ fontSize: 13 }}>{b.count}</div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Create `apps/web/src/components/BarList.test.tsx`**
```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { BarList } from './BarList';

describe('BarList', () => {
  it('renders a labeled bar per bucket', () => {
    render(<BarList buckets={[{ group: 'Delayed', count: 2 }, { group: 'Boarding', count: 1 }]} />);
    expect(screen.getByText('Delayed')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Boarding')).toBeInTheDocument();
  });
  it('shows an empty state', () => {
    render(<BarList buckets={[]} />);
    expect(screen.getByText(/no data/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Create `apps/web/src/views/DashboardsView.tsx`**
```tsx
import { useEffect, useState } from 'react';
import { api, type ObjectTypeSummary } from '../api';
import { BarList } from '../components/BarList';

export function DashboardsView() {
  const [types, setTypes] = useState<ObjectTypeSummary[]>([]);
  const [ot, setOt] = useState('');
  const [groupBy, setGroupBy] = useState('status');
  const [buckets, setBuckets] = useState<Array<{ group: string; count: number }>>([]);
  const [err, setErr] = useState('');

  useEffect(() => { api.listObjectTypes().then((r) => { setTypes(r.objectTypes); if (r.objectTypes[0]) setOt(r.objectTypes[0].apiName); }).catch((e) => setErr((e as Error).message)); }, []);

  async function run() {
    setErr('');
    try { setBuckets((await api.aggregate(ot, groupBy)).buckets); } catch (e) { setErr((e as Error).message); }
  }

  return (
    <div className="card">
      <h2>Dashboards</h2>
      <label htmlFor="dot">Object type</label>
      <select id="dot" value={ot} onChange={(e) => setOt(e.target.value)}>{types.map((t) => <option key={t.apiName} value={t.apiName}>{t.apiName}</option>)}</select>
      <label htmlFor="gb">Group by property</label>
      <input id="gb" value={groupBy} onChange={(e) => setGroupBy(e.target.value)} />
      <div style={{ margin: '10px 0' }}><button onClick={run}>Aggregate</button></div>
      <BarList buckets={buckets} />
      {err ? <div className="err">{err}</div> : null}
    </div>
  );
}
```

- [ ] **Step 5: Create `apps/web/src/views/AskView.tsx`**
```tsx
import { useEffect, useState } from 'react';
import { api, type ObjectTypeSummary } from '../api';

export function AskView() {
  const [types, setTypes] = useState<ObjectTypeSummary[]>([]);
  const [ot, setOt] = useState('');
  const [question, setQuestion] = useState('Summarize these objects.');
  const [answer, setAnswer] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => { api.listObjectTypes().then((r) => { setTypes(r.objectTypes); if (r.objectTypes[0]) setOt(r.objectTypes[0].apiName); }).catch((e) => setErr((e as Error).message)); }, []);

  async function run() {
    setErr(''); setAnswer('');
    try { setAnswer((await api.ask(ot, question)).answer); } catch (e) { setErr((e as Error).message); }
  }

  return (
    <div className="card">
      <h2>Ask (AIP)</h2>
      <p style={{ fontSize: 12, color: '#8a929c' }}>Default provider is <code>echo</code> (offline). Set AIP_PROVIDER=http + AIP_ENDPOINT for a real model.</p>
      <label htmlFor="aot">Object type</label>
      <select id="aot" value={ot} onChange={(e) => setOt(e.target.value)}>{types.map((t) => <option key={t.apiName} value={t.apiName}>{t.apiName}</option>)}</select>
      <label htmlFor="q">Question</label>
      <textarea id="q" rows={3} value={question} onChange={(e) => setQuestion(e.target.value)} />
      <div style={{ margin: '10px 0' }}><button onClick={run}>Ask</button></div>
      {answer ? <pre style={{ whiteSpace: 'pre-wrap', background: '#f0f2f5', padding: 10, borderRadius: 6, fontSize: 12 }}>{answer}</pre> : null}
      {err ? <div className="err">{err}</div> : null}
    </div>
  );
}
```

- [ ] **Step 6: Wire tabs — modify `apps/web/src/App.tsx`**

Add imports:
```tsx
import { DashboardsView } from './views/DashboardsView';
import { AskView } from './views/AskView';
```
Extend the `View` type:
```tsx
type View = 'setup' | 'explorer' | 'admin' | 'dashboards' | 'ask';
```
Add two tabs after the existing tabs (next to "Admin"):
```tsx
        <div className={`tab ${view === 'dashboards' ? 'active' : ''}`} onClick={() => setView('dashboards')}>Dashboards</div>
        <div className={`tab ${view === 'ask' ? 'active' : ''}`} onClick={() => setView('ask')}>Ask</div>
```
Extend the view switch (add before the final `: <ExplorerView .../>`):
```tsx
          : view === 'dashboards' ? <DashboardsView />
          : view === 'ask' ? <AskView />
```
(So the chain is: setup → admin → dashboards → ask → explorer.)

- [ ] **Step 7: Load all modules — modify `apps/web/dev-server.mjs`**

Replace the imports + module list so every module is loaded:
```js
import { createServer, createConfig } from '@so/server';
import { createLogger } from '@so/observability';
import auth from '@so/auth';
import datasets from '@so/datasets';
import ontology from '@so/ontology';
import actions from '@so/actions';
import admin from '@so/admin';
import connectorsDb from '@so/connectors-db';
import pipelines from '@so/pipelines';
import catalog from '@so/catalog';
import lineage from '@so/lineage';
import dashboards from '@so/dashboards';
import aip from '@so/aip';
import automations from '@so/automations';

const server = await createServer({
  modules: [auth, datasets, ontology, actions, admin, connectorsDb, pipelines, catalog, lineage, dashboards, aip, automations],
  logger: createLogger(),
  config: createConfig(),
});
const addr = await server.start(3000);
createLogger().info(`API listening at ${addr}`);
```
Add the new workspace packages to `apps/web/package.json` devDependencies so the bootstrap resolves them: `@so/admin`, `@so/connectors-db`, `@so/pipelines`, `@so/catalog`, `@so/lineage`, `@so/dashboards`, `@so/aip`, `@so/automations` (all `"workspace:*"`). Then `pnpm install`.

- [ ] **Step 8: Typecheck + test → PASS:**
```bash
pnpm --filter @so/web run typecheck
pnpm --filter @so/web test
```
Expected: typecheck clean; component tests = 8 (LoginForm 2 + ObjectsTable 2 + UsersTable 2 + BarList 2). Also `node --check apps/web/dev-server.mjs`.

- [ ] **Step 9: Commit:** `git add -A && git commit -m "feat(web): Dashboards + Ask tabs; dev bootstrap loads all modules"`

---

## Task 2: Full verification + merge
- [ ] `pnpm run infra:up && pnpm run infra:seed && pnpm typecheck && pnpm lint && pnpm test` → green (verify exit code directly; do NOT pipe through grep). Then `pnpm --filter @so/web build`. Then `git checkout main && git merge --ff-only phase19/ui-dashboards-ask`.

---

## Self-review
- **Spec §10 (UI)** — Dashboards (charted aggregation) + Ask (AIP) surfaced; explorer/setup/admin already present. ✓
- **Additive, extensionless imports, bundler resolution** — consistent with apps/web. ✓
- **Demo completeness** — dev bootstrap loads every module so all `/api/*` routes are live. ✓
- **Deferred:** saved dashboards, chart types beyond bars, streaming AIP answers, an app-builder/templates UI. Flagged.
