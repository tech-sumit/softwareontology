import { useEffect, useState } from 'react';
import { api } from '../api';
import { timeAgo } from '../time';

type Run = { id: string; status: string; rowCount: number | null; startedAt: string; pipeline: string };

export function ProjectOverview({ projectName, onGo }: { projectName: string; onGo: (s: string) => void }) {
  const [c, setC] = useState({ datasets: 0, pipelines: 0, connectors: 0, apps: 0 });
  const [activity, setActivity] = useState<Run[]>([]);
  const [datasets, setDatasets] = useState<Array<{ id: string; name: string; rowCount?: number }>>([]);
  useEffect(() => {
    (async () => {
      const [d, p, cdb, ccl, caf, a] = await Promise.all([
        api.listDatasets().catch(() => ({ datasets: [] })), api.listPipelines().catch(() => ({ pipelines: [] })),
        api.listConnectorsDb().catch(() => ({ connectors: [] })), api.listConnectorsCloud().catch(() => ({ connectors: [] })),
        api.listConnectorsAirflow().catch(() => ({ connectors: [] })), api.listApps().catch(() => ({ apps: [] })),
      ]);
      setC({ datasets: d.datasets.length, pipelines: p.pipelines.length, connectors: cdb.connectors.length + ccl.connectors.length + caf.connectors.length, apps: a.apps.length });
      setDatasets(d.datasets.slice(0, 4));
      const runs = await Promise.all(p.pipelines.slice(0, 8).map((pl) => api.pipelineRuns(pl.id).then((r) => r.runs.map((run) => ({ ...run, pipeline: pl.name }))).catch(() => [])));
      setActivity((runs.flat() as Run[]).sort((x, y) => (x.startedAt < y.startedAt ? 1 : -1)).slice(0, 6));
    })().catch(() => {});
  }, []);
  const dc = (s: string) => (s === 'success' ? 'ok' : s === 'failed' ? 'bad' : 'run');
  const di = (s: string) => (s === 'success' ? '✓' : s === 'failed' ? '✗' : '▶');
  return (
    <>
      <div className="crumb">Console / {projectName}</div>
      <div className="hero"><div><h1 className="h1">{projectName}</h1><div className="sub" style={{ margin: 0 }}>Project workspace</div></div></div>
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
      <div className="grid k4">
        {([['datasets', 'Datasets', 'data'], ['pipelines', 'Pipelines', 'pipelines'], ['connectors', 'Connectors', 'connectors'], ['apps', 'Apps', 'apps']] as const).map(([key, label, go]) => (
          <div key={key} className="card kpi" style={{ cursor: 'pointer' }} onClick={() => onGo(go)}><div className="n">{c[key]}</div><div className="l">{label}</div></div>
        ))}
      </div>
      <div className="grid c2 sec">
        <div className="card"><div className="pad" style={{ paddingBottom: 2 }}><h3>Recent pipeline runs</h3></div>
          <div className="feed">
            {activity.length === 0 ? <div className="feeditem"><div className="t muted">No runs yet — create a pipeline to get started.</div></div> :
              activity.map((r) => (<div className="feeditem" key={r.id}><div className={`dot ${dc(r.status)}`}>{di(r.status)}</div><div className="t"><b>{r.pipeline}</b> {r.status}{r.rowCount != null ? ` · ${r.rowCount} rows` : ''}</div><div className="w">{timeAgo(r.startedAt)}</div></div>))}
          </div>
        </div>
        <div><h3 style={{ margin: '0 0 12px', fontSize: 13.5, color: '#2b3550' }}>Recent datasets</h3>
          <div className="grid" style={{ gap: 12 }}>
            {datasets.length === 0 ? <div className="card pin"><div className="pd muted">No datasets yet.</div></div> :
              datasets.map((d) => (<div key={d.id} className="card pin" onClick={() => onGo('data')}><div className="pk">DATASET</div><div className="pt">{d.name}</div><div className="pd">{d.rowCount ?? 0} rows</div></div>))}
          </div>
          <div className="qa" style={{ marginTop: 14 }}><div className="chip" onClick={() => onGo('setup')}>＋ Upload &amp; model</div><div className="chip" onClick={() => onGo('pipelines')}>＋ Pipeline</div></div>
        </div>
      </div>
    </>
  );
}
