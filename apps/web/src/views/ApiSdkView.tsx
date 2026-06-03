import { useEffect, useState } from 'react';
import { api } from '../api';
import { EndpointList, type Endpoint } from '../components/EndpointList';

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'];

function flatten(paths: Record<string, Record<string, unknown>> | undefined): Endpoint[] {
  if (!paths) return [];
  const out: Endpoint[] = [];
  for (const [path, ops] of Object.entries(paths)) {
    if (!ops || typeof ops !== 'object') continue;
    for (const method of Object.keys(ops)) {
      if (HTTP_METHODS.includes(method.toLowerCase())) out.push({ method, path });
    }
  }
  return out;
}

export function ApiSdkView() {
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [err, setErr] = useState('');

  useEffect(() => { api.openapiSpec().then((spec) => setEndpoints(flatten(spec.paths))).catch((e) => setErr((e as Error).message)); }, []);

  return (
    <div className="card">
      <h2>API &amp; SDK</h2>
      <p style={{ color: 'var(--muted)' }}>
        Every surface here is backed by a REST API. The full OpenAPI 3.1 spec is served at{' '}
        <a href="/api/openapi/spec">/api/openapi/spec</a> (<a href="/api/openapi/spec">raw spec</a>). A typed client is generated
        from it via <code>pnpm gen:client</code> into the <code>@so/client</code> package.
      </p>
      <h3>Endpoints</h3>
      <EndpointList endpoints={endpoints} />
      {err ? <div className="err">{err}</div> : null}
    </div>
  );
}
