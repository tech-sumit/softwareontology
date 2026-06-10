import { useState } from 'react';

export interface Endpoint { method: string; path: string; desc?: string; }

function curlFor(e: Endpoint): string {
  const url = `http://localhost:3000/api${e.path}`;
  const auth = `-H 'Authorization: Bearer <your-token>'`;
  if (e.method.toLowerCase() === 'get') return `curl ${auth} ${url}`;
  return `curl -X ${e.method.toUpperCase()} ${auth} -H 'content-type: application/json' -d '{}' ${url}`;
}

export function EndpointList({ endpoints }: { endpoints: Endpoint[] }) {
  const [copied, setCopied] = useState('');
  if (endpoints.length === 0) return <p style={{ color: 'var(--muted)' }}>No endpoints.</p>;
  return (
    <table>
      <thead><tr><th>Method</th><th>Path</th><th>Description</th><th></th></tr></thead>
      <tbody>
        {endpoints.map((e, i) => {
          const key = `${e.method} ${e.path}`;
          return (
            <tr key={i}>
              <td><span className="badge running">{e.method.toUpperCase()}</span></td>
              <td><code>{e.path}</code></td>
              <td style={{ color: 'var(--muted)' }}>{e.desc ?? ''}</td>
              <td>
                <button className="sec" aria-label={`copy curl for ${key}`} onClick={() => { void navigator.clipboard.writeText(curlFor(e)); setCopied(key); }}>
                  {copied === key ? 'Copied' : 'Copy curl'}
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
