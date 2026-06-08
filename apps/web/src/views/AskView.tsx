import { useEffect, useState } from 'react';
import { api, type ObjectTypeSummary } from '../api';
import { SearchResults, type SearchHit } from '../components/SearchResults';

export function AskView() {
  const [types, setTypes] = useState<ObjectTypeSummary[]>([]);
  const [ot, setOt] = useState('');
  const [question, setQuestion] = useState('Summarize these objects.');
  const [answer, setAnswer] = useState('');
  const [err, setErr] = useState('');

  const [stype, setStype] = useState('');
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [smsg, setSmsg] = useState('');

  useEffect(() => { api.listObjectTypes().then((r) => { setTypes(r.objectTypes); if (r.objectTypes[0]) { setOt(r.objectTypes[0].apiName); setStype(r.objectTypes[0].apiName); } }).catch((e) => setErr((e as Error).message)); }, []);

  async function run() {
    setErr(''); setAnswer('');
    try { setAnswer((await api.ask(ot, question)).answer); } catch (e) { setErr((e as Error).message); }
  }

  async function doIndex() { setSmsg('Indexing…'); try { const r = await api.aipIndex(stype); setSmsg(`Indexed ${r.indexed} objects.`); } catch (e) { setSmsg((e as Error).message); } }
  async function doSearch() { try { setHits((await api.aipSearch(stype, q)).results); } catch (e) { setSmsg((e as Error).message); } }

  return (
    <div className="card">
      <h2>Ask (AIP)</h2>
      <p style={{ fontSize: 12, color: 'var(--muted)' }}>Default provider is <code>echo</code> (offline). Set AIP_PROVIDER=http + AIP_ENDPOINT for a real model.</p>
      <label htmlFor="aot">Object type</label>
      <select id="aot" value={ot} onChange={(e) => setOt(e.target.value)}>{types.map((t) => <option key={t.apiName} value={t.apiName}>{t.apiName}</option>)}</select>
      <label htmlFor="q">Question</label>
      <textarea id="q" rows={3} value={question} onChange={(e) => setQuestion(e.target.value)} />
      <div style={{ margin: '10px 0' }}><button onClick={run}>Ask</button></div>
      {answer ? <pre style={{ whiteSpace: 'pre-wrap', background: '#f0f2f5', padding: 10, borderRadius: 6, fontSize: 12 }}>{answer}</pre> : null}
      {err ? <div className="err">{err}</div> : null}

      <div className="card" style={{ marginTop: 18 }}>
        <h3>Semantic search</h3>
        <p className="muted">Embed an object type, then search it by meaning (not just keywords).</p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select aria-label="search type" value={stype} onChange={(e) => setStype(e.target.value)}>{types.map((t) => <option key={t.apiName} value={t.apiName}>{t.apiName}</option>)}</select>
          <button className="sec" onClick={doIndex}>Index</button>
          <input aria-label="search query" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. delayed flights to Boston" style={{ minWidth: 260 }} onKeyDown={(e) => { if (e.key === 'Enter') doSearch(); }} />
          <button onClick={doSearch}>Search</button>
        </div>
        {smsg ? <div className="muted" style={{ marginTop: 8 }}>{smsg}</div> : null}
        <div style={{ marginTop: 12 }}><SearchResults hits={hits} /></div>
      </div>
    </div>
  );
}
