import { useEffect, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { sql as sqlLang } from '@codemirror/lang-sql';
import { api } from '../api';
import { RunsTable, type PipelineRun } from '../components/RunsTable';

type Step = { name: string; sql: string };
type Exp = { type: string; column: string };

export function PipelinesView() {
  const [pipelines, setPipelines] = useState<Array<{ id: string; name: string; inputs: string[] }>>([]);
  const [datasets, setDatasets] = useState<Array<{ id: string; name: string }>>([]);
  const [sel, setSel] = useState<string>('');
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  // create form
  const [name, setName] = useState('');
  const [inputs, setInputs] = useState<string[]>([]);
  const [mode, setMode] = useState<'sql' | 'dag'>('sql');
  const [sql, setSql] = useState('SELECT * FROM ');
  const [steps, setSteps] = useState<Step[]>([{ name: 'step1', sql: '' }]);
  const [exps, setExps] = useState<Exp[]>([]);
  const [cron, setCron] = useState('*/5 * * * *');

  async function reload() { try { setPipelines((await api.listPipelines()).pipelines); } catch (e) { setErr((e as Error).message); } }
  useEffect(() => { reload(); api.listDatasets().then((r) => setDatasets(r.datasets)).catch(() => setDatasets([])); }, []);
  async function loadRuns(id: string) { setSel(id); setErr(''); try { setRuns((await api.pipelineRuns(id)).runs); } catch (e) { setErr((e as Error).message); } }

  async function create() {
    setErr(''); setMsg('');
    const body: Record<string, unknown> = { name, inputs };
    if (mode === 'dag') body.steps = steps.filter((s) => s.name && s.sql);
    else body.sql = sql;
    const cleanExps = exps.filter((e) => e.type && e.column);
    if (cleanExps.length) body.expectations = cleanExps.map((e) => ({ type: e.type, column: e.column }));
    try { await api.createPipeline(body); setName(''); setInputs([]); setSql('SELECT * FROM '); setSteps([{ name: 'step1', sql: '' }]); setExps([]); await reload(); setMsg('Pipeline created.'); }
    catch (e) { setErr((e as Error).message); }
  }
  async function run(id: string) { setErr(''); setMsg(''); try { const r = await api.runPipeline(id); setMsg(`Run ${r.runId.slice(0, 8)} → ${r.rowCount} rows`); await loadRuns(id); } catch (e) { setErr((e as Error).message); await loadRuns(id); } }
  async function schedule(id: string) { setErr(''); setMsg(''); try { await api.setPipelineSchedule(id, cron); setMsg(`Scheduled: ${cron}`); } catch (e) { setErr((e as Error).message); } }
  async function unschedule(id: string) { setErr(''); try { await api.clearPipelineSchedule(id); setMsg('Schedule cleared.'); } catch (e) { setErr((e as Error).message); } }
  async function remove(id: string) {
    const p = pipelines.find((x) => x.id === id);
    if (!window.confirm(`Delete pipeline “${p?.name ?? id}” and its run history?`)) return;
    setErr(''); setMsg('');
    try { await api.deletePipeline(id); if (sel === id) { setSel(''); setRuns([]); } await reload(); setMsg('Pipeline deleted.'); }
    catch (e) { setErr((e as Error).message); }
  }

  return (
    <div className="card">
      <h2>Pipelines</h2>
      <div style={{ display: 'flex', gap: 24 }}>
        <div style={{ minWidth: 220 }}>
          <h3>In this project</h3>
          {pipelines.length === 0 ? <p style={{ color: 'var(--muted)' }}>None yet.</p> : (
            <ul className="plain">{pipelines.map((p) => <li key={p.id} className={`listln${sel === p.id ? ' sel' : ''}`} onClick={() => loadRuns(p.id)}>{p.name} <em style={{ color: 'var(--muted)' }}>({p.inputs.join(', ')})</em></li>)}</ul>
          )}
        </div>
        <div style={{ flex: 1 }}>
          {sel ? (
            <div>
              <h3>Build health</h3>
              <div style={{ marginBottom: 8 }}><button onClick={() => run(sel)}>Run now</button> <button className="sec" onClick={() => remove(sel)}>Delete</button></div>
              <RunsTable runs={runs} />
              <div style={{ marginTop: 12 }}>
                <label htmlFor="cron">Cron</label> <input id="cron" value={cron} onChange={(e) => setCron(e.target.value)} style={{ width: 140 }} />
                <button onClick={() => schedule(sel)}>Schedule</button> <button className="sec" onClick={() => unschedule(sel)}>Clear</button>
              </div>
            </div>
          ) : <p style={{ color: 'var(--muted)' }}>Select a pipeline to run it and view build health.</p>}
        </div>
      </div>

      <div style={{ borderTop: '1px solid var(--line)', marginTop: 16, paddingTop: 12 }}>
        <h3>New pipeline</h3>
        <label htmlFor="pname">Name</label> <input id="pname" value={name} onChange={(e) => setName(e.target.value)} placeholder="delayed_flights" />
        <label htmlFor="pin"> Inputs (datasets in this project)</label>{' '}
        <select id="pin" multiple aria-label="pipeline inputs" size={4} value={inputs}
          onChange={(e) => setInputs(Array.from(e.target.selectedOptions).map((o) => o.value))}>
          {Array.from(new Set(datasets.map((d) => d.name))).map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <div style={{ margin: '8px 0' }}>
          <label><input type="radio" name="mode" checked={mode === 'sql'} onChange={() => setMode('sql')} aria-label="single sql" /> Single SQL</label>{' '}
          <label><input type="radio" name="mode" checked={mode === 'dag'} onChange={() => setMode('dag')} aria-label="dag steps" /> Steps (DAG)</label>
        </div>
        {mode === 'sql' ? (
          <div style={{ border: '1px solid var(--line)', borderRadius: 6 }}>
            <CodeMirror value={sql} height="140px" extensions={[sqlLang()]} onChange={(v) => setSql(v)} aria-label="pipeline sql" basicSetup={{ lineNumbers: true, foldGutter: false }} />
          </div>
        ) : (
          <div>
            {steps.map((s, i) => (
              <div key={i} style={{ marginBottom: 4, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <input aria-label={`step ${i} name`} value={s.name} onChange={(e) => setSteps((ss) => ss.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} placeholder="step name" style={{ width: 120 }} />
                <div style={{ width: '60%', border: '1px solid var(--line)', borderRadius: 6 }}>
                  <CodeMirror value={s.sql} height="80px" extensions={[sqlLang()]} onChange={(v) => setSteps((ss) => ss.map((x, j) => j === i ? { ...x, sql: v } : x))} aria-label={`step ${i} sql`} basicSetup={{ lineNumbers: true, foldGutter: false }} />
                </div>
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
