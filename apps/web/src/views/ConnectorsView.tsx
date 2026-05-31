import { useEffect, useState } from 'react';
import { api } from '../api';
import { ConnectorList } from '../components/ConnectorList';

export function ConnectorsView() {
  // lists
  const [dbConns, setDbConns] = useState<Array<{ id: string; name: string }>>([]);
  const [cloudConns, setCloudConns] = useState<Array<{ id: string; name: string; kind: string }>>([]);
  const [airflowConns, setAirflowConns] = useState<Array<{ id: string; name: string; provider: string }>>([]);

  // DB form
  const [dbName, setDbName] = useState('');
  const [dbConnString, setDbConnString] = useState('');
  const [dbTable, setDbTable] = useState('');
  const [dbMsg, setDbMsg] = useState('');
  const [dbErr, setDbErr] = useState('');

  // Cloud form (S3 | REST)
  const [cloudKind, setCloudKind] = useState<'s3' | 'rest'>('s3');
  const [cloudName, setCloudName] = useState('');
  const [s3Url, setS3Url] = useState('');
  const [s3Format, setS3Format] = useState('csv');
  const [restUrl, setRestUrl] = useState('');
  const [restArrayPath, setRestArrayPath] = useState('');
  const [cloudMsg, setCloudMsg] = useState('');
  const [cloudErr, setCloudErr] = useState('');

  // Airflow form
  const [afName, setAfName] = useState('');
  const [afProvider, setAfProvider] = useState('');
  const [afConn, setAfConn] = useState('');
  const [afQuery, setAfQuery] = useState('');
  const [afMsg, setAfMsg] = useState('');
  const [afErr, setAfErr] = useState('');

  async function loadDb() { try { setDbConns((await api.listConnectorsDb()).connectors); } catch (e) { setDbErr((e as Error).message); } }
  async function loadCloud() { try { setCloudConns((await api.listConnectorsCloud()).connectors); } catch (e) { setCloudErr((e as Error).message); } }
  async function loadAirflow() { try { setAirflowConns((await api.listConnectorsAirflow()).connectors); } catch (e) { setAfErr((e as Error).message); } }
  useEffect(() => { void loadDb(); void loadCloud(); void loadAirflow(); }, []);

  async function createDb() {
    setDbErr(''); setDbMsg('');
    try { await api.createConnectorDb({ name: dbName, sourceConnString: dbConnString, sourceTable: dbTable }); setDbName(''); setDbConnString(''); setDbTable(''); await loadDb(); setDbMsg('Connector created.'); }
    catch (e) { setDbErr((e as Error).message); }
  }
  async function syncDb(id: string) {
    setDbErr(''); setDbMsg('');
    try { const r = await api.syncConnectorDb(id); setDbMsg(`Synced → dataset ${r.datasetId.slice(0, 8)} (${r.rowCount} rows)`); }
    catch (e) { setDbErr((e as Error).message); }
  }

  async function createCloud() {
    setCloudErr(''); setCloudMsg('');
    try {
      if (cloudKind === 's3') await api.createConnectorS3({ name: cloudName, s3Url, format: s3Format });
      else await api.createConnectorRest({ name: cloudName, url: restUrl, ...(restArrayPath ? { arrayPath: restArrayPath } : {}) });
      setCloudName(''); setS3Url(''); setRestUrl(''); setRestArrayPath(''); await loadCloud(); setCloudMsg('Connector created.');
    } catch (e) { setCloudErr((e as Error).message); }
  }
  async function syncCloud(id: string) {
    setCloudErr(''); setCloudMsg('');
    try { const r = await api.syncConnectorCloud(id); setCloudMsg(`Synced → dataset ${r.datasetId.slice(0, 8)} (${r.rowCount} rows)`); }
    catch (e) { setCloudErr((e as Error).message); }
  }

  async function createAirflow() {
    setAfErr(''); setAfMsg('');
    try { await api.createConnectorAirflow({ name: afName, provider: afProvider, conn: afConn, query: afQuery }); setAfName(''); setAfProvider(''); setAfConn(''); setAfQuery(''); await loadAirflow(); setAfMsg('Connector created.'); }
    catch (e) { setAfErr((e as Error).message); }
  }
  async function syncAirflow(id: string) {
    setAfErr(''); setAfMsg('');
    try { const r = await api.syncConnectorAirflow(id); setAfMsg(`Synced → dataset ${r.datasetId.slice(0, 8)} (${r.rowCount} rows)`); }
    catch (e) { setAfErr((e as Error).message); }
  }

  return (
    <div className="card">
      <h2>Connectors</h2>
      <p style={{ color: '#8a929c' }}>Pull external data into this project as datasets. Create a connector, then Sync to ingest.</p>

      <div style={{ borderTop: '1px solid #2a2f37', marginTop: 12, paddingTop: 12 }}>
        <h3>Database (Postgres)</h3>
        <ConnectorList connectors={dbConns} onSync={syncDb} />
        <div style={{ marginTop: 8 }}>
          <label htmlFor="db-name">Name</label> <input id="db-name" value={dbName} onChange={(e) => setDbName(e.target.value)} placeholder="sales-db" />
          <label htmlFor="db-conn"> Connection string</label> <input id="db-conn" value={dbConnString} onChange={(e) => setDbConnString(e.target.value)} placeholder="postgresql://user:pass@host:5432/db" style={{ width: 320 }} />
          <label htmlFor="db-table"> Source table</label> <input id="db-table" value={dbTable} onChange={(e) => setDbTable(e.target.value)} placeholder="public.orders" />
          <button onClick={createDb}>Create</button>
        </div>
        {dbMsg ? <div style={{ color: '#3fb950', marginTop: 8 }}>{dbMsg}</div> : null}
        {dbErr ? <div className="err">{dbErr}</div> : null}
      </div>

      <div style={{ borderTop: '1px solid #2a2f37', marginTop: 16, paddingTop: 12 }}>
        <h3>Cloud (S3 / REST)</h3>
        <ConnectorList connectors={cloudConns} onSync={syncCloud} />
        <div style={{ margin: '8px 0' }}>
          <label><input type="radio" name="cloud-kind" checked={cloudKind === 's3'} onChange={() => setCloudKind('s3')} aria-label="s3 source" /> S3</label>{' '}
          <label><input type="radio" name="cloud-kind" checked={cloudKind === 'rest'} onChange={() => setCloudKind('rest')} aria-label="rest source" /> REST</label>
        </div>
        <div>
          <label htmlFor="cloud-name">Name</label> <input id="cloud-name" value={cloudName} onChange={(e) => setCloudName(e.target.value)} placeholder="events" />
          {cloudKind === 's3' ? (
            <>
              <label htmlFor="s3-url"> S3 URL</label> <input id="s3-url" value={s3Url} onChange={(e) => setS3Url(e.target.value)} placeholder="s3://bucket/data.csv" style={{ width: 280 }} />
              <label htmlFor="s3-format"> Format</label>{' '}
              <select id="s3-format" value={s3Format} onChange={(e) => setS3Format(e.target.value)}>
                <option value="csv">csv</option><option value="parquet">parquet</option>
              </select>
            </>
          ) : (
            <>
              <label htmlFor="rest-url"> URL</label> <input id="rest-url" value={restUrl} onChange={(e) => setRestUrl(e.target.value)} placeholder="https://api.example.com/items" style={{ width: 280 }} />
              <label htmlFor="rest-path"> Array path (optional)</label> <input id="rest-path" value={restArrayPath} onChange={(e) => setRestArrayPath(e.target.value)} placeholder="data" />
            </>
          )}
          <button onClick={createCloud}>Create</button>
        </div>
        {cloudMsg ? <div style={{ color: '#3fb950', marginTop: 8 }}>{cloudMsg}</div> : null}
        {cloudErr ? <div className="err">{cloudErr}</div> : null}
      </div>

      <div style={{ borderTop: '1px solid #2a2f37', marginTop: 16, paddingTop: 12 }}>
        <h3>Airflow (connector-runner)</h3>
        <ConnectorList connectors={airflowConns} onSync={syncAirflow} />
        <div style={{ marginTop: 8 }}>
          <label htmlFor="af-name">Name</label> <input id="af-name" value={afName} onChange={(e) => setAfName(e.target.value)} placeholder="warehouse" />
          <label htmlFor="af-provider"> Provider</label> <input id="af-provider" value={afProvider} onChange={(e) => setAfProvider(e.target.value)} placeholder="postgres" />
          <label htmlFor="af-conn"> Conn</label> <input id="af-conn" value={afConn} onChange={(e) => setAfConn(e.target.value)} placeholder="conn id / dsn" />
          <label htmlFor="af-query"> Query</label> <input id="af-query" value={afQuery} onChange={(e) => setAfQuery(e.target.value)} placeholder="SELECT * FROM t" style={{ width: 240 }} />
          <button onClick={createAirflow}>Create</button>
        </div>
        {afMsg ? <div style={{ color: '#3fb950', marginTop: 8 }}>{afMsg}</div> : null}
        {afErr ? <div className="err">{afErr}</div> : null}
      </div>
    </div>
  );
}
