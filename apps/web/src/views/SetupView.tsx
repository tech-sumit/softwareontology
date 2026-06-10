import { useState } from 'react';
import { api } from '../api';

type PropType = 'string' | 'int' | 'float' | 'bool' | 'timestamp';
const PROP_TYPES: PropType[] = ['string', 'int', 'float', 'bool', 'timestamp'];

type MappingRow = { col: string; prop: string; type: PropType };

function camelCase(col: string): string {
  return col.trim().replace(/[_\-\s]+(.)/g, (_, c: string) => c.toUpperCase()).replace(/^([A-Z])/, (c) => c.toLowerCase());
}

function inferType(value: string | undefined): PropType {
  if (value === undefined || value.trim() === '') return 'string';
  const v = value.trim();
  if (/^-?\d+$/.test(v)) return 'int';
  if (!Number.isNaN(Number(v))) return 'float';
  return 'string';
}

function deriveMapping(csv: string): MappingRow[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return [];
  const cols = lines[0]!.split(',').map((c) => c.trim()).filter((c) => c !== '');
  const firstRow = lines[1]?.split(',').map((c) => c.trim());
  return cols.map((col, i) => ({ col, prop: camelCase(col), type: inferType(firstRow?.[i]) }));
}

export function SetupView({ onModeled }: { onModeled: () => void }) {
  const [csv, setCsvRaw] = useState('');
  const [name, setName] = useState('');
  const [otName, setOtName] = useState('');
  const [rows, setRows] = useState<MappingRow[]>([]);
  const [pk, setPk] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  function setCsv(text: string) {
    setCsvRaw(text);
    const mapping = deriveMapping(text);
    setRows(mapping);
    setPk(mapping[0]?.col ?? '');
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setCsv(await file.text());
    if (!name) setName(file.name.replace(/\.csv$/i, ''));
  }

  function updateRow(i: number, patch: Partial<MappingRow>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  async function run() {
    setErr(''); setMsg('');
    try {
      const pkRow = rows.find((r) => r.col === pk) ?? rows[0];
      if (!pkRow) throw new Error('Provide a CSV with a header row first.');
      const { dataset } = await api.uploadCsv(name, csv);
      await api.createObjectType({
        apiName: otName, datasetId: dataset.id, primaryKey: pkRow.prop,
        properties: rows.map((r) => ({ apiName: r.prop, column: r.col, type: r.type })),
      });
      setMsg(`Modeled "${otName}" from dataset "${name}".`);
      onModeled();
    } catch (e) { setErr((e as Error).message); }
  }

  return (
    <div className="card pad formcard">
      <h2>Upload &amp; model</h2>
      <div className="frow">
        <div className="field">
          <label htmlFor="dsname">Dataset name</label>
          <input id="dsname" value={name} placeholder="flights" onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="ot">Object type name</label>
          <input id="ot" value={otName} placeholder="Flight" onChange={(e) => setOtName(e.target.value)} />
        </div>
      </div>
      <div className="field" style={{ marginTop: 14 }}>
        <label htmlFor="csvfile">Upload a CSV file or paste below</label>
        <input id="csvfile" type="file" accept=".csv" aria-label="csv file" onChange={(e) => void onFile(e.target.files?.[0])} />
      </div>
      <div className="field" style={{ marginTop: 8 }}>
        <label htmlFor="csv">CSV</label>
        <textarea id="csv" rows={6} value={csv} placeholder={'flight_no,status,seats\nFL-204,Delayed,189\nFL-118,Boarding,142'} onChange={(e) => setCsv(e.target.value)} />
      </div>
      {rows.length > 0 ? (
        <div style={{ marginTop: 8 }}>
          <div className="label">COLUMN MAPPING</div>
          <table>
            <thead><tr><th>Column</th><th>Property</th><th>Type</th><th>Primary key</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.col}>
                  <td><code>{r.col}</code></td>
                  <td><input aria-label={`prop for ${r.col}`} value={r.prop} onChange={(e) => updateRow(i, { prop: e.target.value })} /></td>
                  <td>
                    <select aria-label={`type for ${r.col}`} value={r.type} onChange={(e) => updateRow(i, { type: e.target.value as PropType })}>
                      {PROP_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </td>
                  <td><input type="radio" name="pk" aria-label={`pk ${r.col}`} checked={pk === r.col} onChange={() => setPk(r.col)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <div style={{ marginTop: 10 }}><button onClick={run}>Upload &amp; model</button></div>
      {msg ? <div style={{ color: '#1e7a44', marginTop: 8 }}>{msg}</div> : null}
      {err ? <div className="err">{err}</div> : null}
    </div>
  );
}
