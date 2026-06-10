import { useEffect, useState } from 'react';
import { api, type ObjectTypeSummary, type ObjectTypeLineage } from '../api';
import { LineageGraph, type LineageData } from '../components/LineageGraph';

type LinkType = { apiName: string; fromObjectType: string; toObjectType: string };

export function LineageView({ onOpenType }: { onOpenType?: (apiName: string) => void }) {
  const [types, setTypes] = useState<ObjectTypeSummary[]>([]);
  const [linkTypes, setLinkTypes] = useState<LinkType[]>([]);
  const [selected, setSelected] = useState('');
  const [lineage, setLineage] = useState<ObjectTypeLineage | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.listObjectTypes().then((r) => setTypes(r.objectTypes)).catch((e) => setErr((e as Error).message));
    api.listLinkTypes().then((r) => setLinkTypes(r.linkTypes)).catch(() => setLinkTypes([]));
  }, []);

  async function pick(apiName: string) {
    setSelected(apiName); setErr(''); setLineage(null);
    if (!apiName) return;
    try { setLineage((await api.getLineage(apiName)).lineage); }
    catch (e) { setErr((e as Error).message); }
  }

  const data: LineageData | null = lineage ? {
    objectType: lineage.objectType,
    dataset: lineage.backingDataset ? { id: lineage.backingDataset, name: lineage.backingDataset } : null,
    actions: lineage.actions,
    links: lineage.links.map((apiName) => {
      const lt = linkTypes.find((l) => l.apiName === apiName);
      const to = lt ? (lt.fromObjectType === lineage.objectType ? lt.toObjectType : lt.fromObjectType) : apiName;
      return { apiName, toObjectType: to };
    }),
  } : null;

  return (
    <div className="card">
      <h2>Lineage</h2>
      <p style={{ color: 'var(--muted)' }}>Pick an object type to see its backing dataset, actions, and links.</p>
      {types.length === 0 ? <p style={{ color: 'var(--muted)' }}>No object types yet &mdash; use &ldquo;Upload &amp; model&rdquo;.</p> : (
        <div>
          <label htmlFor="lineage-type">Object type</label>{' '}
          <select id="lineage-type" value={selected} onChange={(e) => void pick(e.target.value)}>
            <option value="">Select&hellip;</option>
            {types.map((t) => <option key={t.apiName} value={t.apiName}>{t.apiName}</option>)}
          </select>
        </div>
      )}
      {data ? (
        <div style={{ marginTop: 12 }}>
          <LineageGraph data={data} onOpenType={(t) => onOpenType?.(t)} />
        </div>
      ) : null}
      {err ? <div className="err">{err}</div> : null}
    </div>
  );
}
