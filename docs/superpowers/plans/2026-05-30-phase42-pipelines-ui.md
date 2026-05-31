# Phase 42 — Pipelines Surface UI Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps `- [ ]`.

**Goal:** Replace the Pipelines placeholder with a real surface that wires the existing `@so/pipelines` API: list pipelines (active project), create one (single SQL **or** a multi-step **DAG**, plus optional data-quality **expectations**), **run** it, see **build-health runs history**, and set/clear a **cron schedule**.

**Architecture:** A pure `RunsTable` component (jsdom-tested) + a stateful `PipelinesView`. New `api.ts` pipeline methods. `App.tsx` swaps the Pipelines placeholder for `PipelinesView`.

---

## Pre-flight
- [ ] **Branch:** `git checkout main && git checkout -b phase42/pipelines-ui`

---

## Task 1: API methods

**Files:** Modify `apps/web/src/api.ts`

- [ ] **Step 1:** Add inside the `api` object:
```ts
  listPipelines: () => req<{ pipelines: Array<{ id: string; name: string; inputs: string[] }> }>('GET', '/pipelines'),
  createPipeline: (body: unknown) => req<{ id: string }>('POST', '/pipelines', body),
  runPipeline: (id: string) => req<{ datasetId: string; rowCount: number; runId: string }>('POST', `/pipelines/${id}/run`),
  pipelineRuns: (id: string) => req<{ runs: Array<{ id: string; status: string; trigger: string; rowCount: number | null; error: string | null; startedAt: string }> }>('GET', `/pipelines/${id}/runs`),
  setPipelineSchedule: (id: string, cron: string) => req<{ ok: boolean }>('PUT', `/pipelines/${id}/schedule`, { cron }),
  clearPipelineSchedule: (id: string) => req<{ ok: boolean }>('DELETE', `/pipelines/${id}/schedule`),
```

---

## Task 2: `RunsTable` pure component (+ test)

**Files:** Create `apps/web/src/components/RunsTable.tsx`, `apps/web/src/components/RunsTable.test.tsx`

- [ ] **Step 1: `RunsTable.tsx`**
```tsx
export interface PipelineRun { id: string; status: string; trigger: string; rowCount: number | null; error: string | null; startedAt: string; }

export function RunsTable({ runs }: { runs: PipelineRun[] }) {
  if (runs.length === 0) return <p style={{ color: '#8a929c' }}>No runs yet.</p>;
  return (
    <table>
      <thead><tr><th>Status</th><th>Trigger</th><th>Rows</th><th>Error</th></tr></thead>
      <tbody>
        {runs.map((r) => (
          <tr key={r.id}>
            <td><span className={`badge ${r.status}`}>{r.status}</span></td>
            <td>{r.trigger}</td>
            <td>{r.rowCount ?? ''}</td>
            <td style={{ color: '#f85149' }}>{r.error ?? ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 2: `RunsTable.test.tsx`**
```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { RunsTable } from './RunsTable';

describe('RunsTable', () => {
  it('renders run status/trigger/error', () => {
    render(<RunsTable runs={[
      { id: '1', status: 'success', trigger: 'manual', rowCount: 3, error: null, startedAt: '2026-05-30T12:00:00Z' },
      { id: '2', status: 'failed', trigger: 'schedule', rowCount: null, error: 'boom', startedAt: '2026-05-30T12:01:00Z' },
    ]} />);
    expect(screen.getByText('success')).toBeInTheDocument();
    expect(screen.getByText('failed')).toBeInTheDocument();
    expect(screen.getByText('schedule')).toBeInTheDocument();
    expect(screen.getByText('boom')).toBeInTheDocument();
  });
  it('empty state', () => {
    render(<RunsTable runs={[]} />);
    expect(screen.getByText(/no runs/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run → PASS:** `pnpm --filter @so/web test -- RunsTable` (timeout 120000).

---

## Task 3: `PipelinesView` + nav wiring + styles

**Files:** Create `apps/web/src/views/PipelinesView.tsx`; Modify `apps/web/src/App.tsx`, `apps/web/src/styles.css`

- [ ] **Step 1: `views/PipelinesView.tsx`**
```tsx
import { useEffect, useState } from 'react';
import { api } from '../api';
import { RunsTable, type PipelineRun } from '../components/RunsTable';

type Step = { name: string; sql: string };
type Exp = { type: string; column: string };

export function PipelinesView() {
  const [pipelines, setPipelines] = useState<Array<{ id: string; name: string; inputs: string[] }>>([]);
  const [sel, setSel] = useState<string>('');
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  // create form
  const [name, setName] = useState('');
  const [inputs, setInputs] = useState('');
  const [mode, setMode] = useState<'sql' | 'dag'>('sql');
  const [sql, setSql] = useState('SELECT * FROM ');
  const [steps, setSteps] = useState<Step[]>([{ name: 'step1', sql: '' }]);
  const [exps, setExps] = useState<Exp[]>([]);
  const [cron, setCron] = useState('*/5 * * * *');

  async function reload() { try { setPipelines((await api.listPipelines()).pipelines); } catch (e) { setErr((e as Error).message); } }
  useEffect(() => { reload(); }, []);
  async function loadRuns(id: string) { setSel(id); setErr(''); try { setRuns((await api.pipelineRuns(id)).runs); } catch (e) { setErr((e as Error).message); } }

  async function create() {
    setErr(''); setMsg('');
    const body: Record<string, unknown> = { name, inputs: inputs.split(',').map((s) => s.trim()).filter(Boolean) };
    if (mode === 'dag') body.steps = steps.filter((s) => s.name && s.sql);
    else body.sql = sql;
    const cleanExps = exps.filter((e) => e.type && e.column);
    if (cleanExps.length) body.expectations = cleanExps.map((e) => ({ type: e.type, column: e.column }));
    try { await api.createPipeline(body); setName(''); setInputs(''); setSql('SELECT * FROM '); setSteps([{ name: 'step1', sql: '' }]); setExps([]); await reload(); setMsg('Pipeline created.'); }
    catch (e) { setErr((e as Error).message); }
  }
  async function run(id: string) { setErr(''); setMsg(''); try { const r = await api.runPipeline(id); setMsg(`Run ${r.runId.slice(0, 8)} → ${r.rowCount} rows`); await loadRuns(id); } catch (e) { setErr((e as Error).message); await loadRuns(id); } }
  async function schedule(id: string) { setErr(''); setMsg(''); try { await api.setPipelineSchedule(id, cron); setMsg(`Scheduled: ${cron}`); } catch (e) { setErr((e as Error).message); } }
  async function unschedule(id: string) { setErr(''); try { await api.clearPipelineSchedule(id); setMsg('Schedule cleared.'); } catch (e) { setErr((e as Error).message); } }

  return (
    <div className="card">
      <h2>Pipelines</h2>
      <div style={{ display: 'flex', gap: 24 }}>
        <div style={{ minWidth: 220 }}>
          <h3>In this project</h3>
          {pipelines.length === 0 ? <p style={{ color: '#8a929c' }}>None yet.</p> : (
            <ul className="plain">{pipelines.map((p) => <li key={p.id} className={sel === p.id ? 'sel' : ''} style={{ cursor: 'pointer', padding: '4px 0' }} onClick={() => loadRuns(p.id)}>{p.name} <em style={{ color: '#8a929c' }}>({p.inputs.join(', ')})</em></li>)}</ul>
          )}
        </div>
        <div style={{ flex: 1 }}>
          {sel ? (
            <div>
              <h3>Build health</h3>
              <div style={{ marginBottom: 8 }}><button onClick={() => run(sel)}>Run now</button></div>
              <RunsTable runs={runs} />
              <div style={{ marginTop: 12 }}>
                <label htmlFor="cron">Cron</label> <input id="cron" value={cron} onChange={(e) => setCron(e.target.value)} style={{ width: 140 }} />
                <button onClick={() => schedule(sel)}>Schedule</button> <button className="sec" onClick={() => unschedule(sel)}>Clear</button>
              </div>
            </div>
          ) : <p style={{ color: '#8a929c' }}>Select a pipeline to run it and view build health.</p>}
        </div>
      </div>

      <div style={{ borderTop: '1px solid #2a2f37', marginTop: 16, paddingTop: 12 }}>
        <h3>New pipeline</h3>
        <label htmlFor="pname">Name</label> <input id="pname" value={name} onChange={(e) => setName(e.target.value)} placeholder="delayed_flights" />
        <label htmlFor="pin"> Inputs (comma-sep dataset names)</label> <input id="pin" value={inputs} onChange={(e) => setInputs(e.target.value)} placeholder="flights" />
        <div style={{ margin: '8px 0' }}>
          <label><input type="radio" name="mode" checked={mode === 'sql'} onChange={() => setMode('sql')} aria-label="single sql" /> Single SQL</label>{' '}
          <label><input type="radio" name="mode" checked={mode === 'dag'} onChange={() => setMode('dag')} aria-label="dag steps" /> Steps (DAG)</label>
        </div>
        {mode === 'sql' ? (
          <textarea aria-label="sql" value={sql} onChange={(e) => setSql(e.target.value)} rows={3} style={{ width: '100%' }} />
        ) : (
          <div>
            {steps.map((s, i) => (
              <div key={i} style={{ marginBottom: 4 }}>
                <input aria-label={`step ${i} name`} value={s.name} onChange={(e) => setSteps((ss) => ss.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} placeholder="step name" style={{ width: 120 }} />
                <input aria-label={`step ${i} sql`} value={s.sql} onChange={(e) => setSteps((ss) => ss.map((x, j) => j === i ? { ...x, sql: e.target.value } : x))} placeholder="SELECT ... (reads inputs / earlier steps)" style={{ width: '60%' }} />
              </div>
            ))}
            <button className="sec" onClick={() => setSteps((ss) => [...ss, { name: `step${ss.length + 1}`, sql: '' }])}>+ Step</button>
          </div>
        )}
        <div style={{ marginTop: 8 }}>
          <b>Expectations</b> (optional data-quality gates){' '}
          <button className="sec" onClick={() => setExps((xs) => [...xs, { type: 'not_null', column: '' }])}>+ Expectation</button>
          {exps.map((e, i) => (
            <div key={i}>
              <select aria-label={`exp ${i} type`} value={e.type} onChange={(ev) => setExps((xs) => xs.map((x, j) => j === i ? { ...x, type: ev.target.value } : x))}>
                <option value="not_null">not_null</option><option value="unique">unique</option>
              </select>
              <input aria-label={`exp ${i} column`} value={e.column} onChange={(ev) => setExps((xs) => xs.map((x, j) => j === i ? { ...x, column: ev.target.value } : x))} placeholder="column" />
            </div>
          ))}
        </div>
        <div style={{ marginTop: 10 }}><button onClick={create}>Create pipeline</button></div>
      </div>
      {msg ? <div style={{ color: '#3fb950', marginTop: 8 }}>{msg}</div> : null}
      {err ? <div className="err">{err}</div> : null}
    </div>
  );
}
```

- [ ] **Step 2: Wire nav — modify `apps/web/src/App.tsx`** — import `PipelinesView` and change the `case 'pipelines':` line from `<PlaceholderView title="Pipelines" />` to `<PipelinesView key={refreshKey} />`.

- [ ] **Step 3: Styles — append to `apps/web/src/styles.css`**
```css
.badge { padding: 2px 8px; border-radius: 10px; font-size: 12px; text-transform: capitalize; }
.badge.success { background: #1f6f3f; color: #fff; }
.badge.failed { background: #8b1a1a; color: #fff; }
.badge.running { background: #9e6a00; color: #fff; }
ul.plain { list-style: none; padding: 0; margin: 0; }
```

- [ ] **Step 4: Verify the web package:** `pnpm --filter @so/web typecheck` (0); `pnpm --filter @so/web test` (all pass incl. RunsTable); `pnpm --filter @so/web build` (succeeds). (timeout 180000). No unused imports; no `eslint-disable react-hooks/exhaustive-deps`.

- [ ] **Step 5: Commit:** `git add -A && git commit -m "feat(web): Pipelines surface — list, create (SQL/DAG + expectations), run, build-health, schedule"`

---

## Task 4: Full verification + merge (GATED)
- [ ] `pnpm typecheck; pnpm lint`; then `pnpm test >/tmp/v.log 2>&1; t=$?; grep -E "Tests +[0-9]+ (passed|failed)" /tmp/v.log | tail -1`. **Only if tc/lint/`t` all 0**: `git checkout main && git merge --ff-only phase42/pipelines-ui`. (Flaky env: if mass ~60000ms timeouts or `ERR_IPC_CHANNEL_CLOSED` with tests otherwise passing — re-run; ensure Docker up via `open -a Docker`.)

---

## Self-review
- **Pipelines surfaced** — list (project-scoped), create single-SQL **or** multi-step DAG + optional expectations, run, build-health runs history, cron schedule. The headline "DAGs" capability is now in the UI. ✓
- **Testable** — pure `RunsTable` jsdom-tested. ✓
- **Pattern-consistent** — flat `api` methods; stateful view; `key={refreshKey}` so a project switch refetches. ✓
- **Deferred:** incremental-pipeline form fields (backend supports it); per-run drill-down/logs; run cancellation; richer DAG editor. Flagged.
