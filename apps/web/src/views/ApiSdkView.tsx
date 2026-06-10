import { useCallback, useEffect, useState } from 'react';
import { api, type ApiTokenSummary } from '../api';
import { EndpointList, type Endpoint } from '../components/EndpointList';
import { timeAgo } from '../time';

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'];

/** Accurate one-line descriptions per documented endpoint (`method path`). */
const DESCRIPTIONS: Record<string, string> = {
  'post /auth/login': 'Authenticate with email + password; sets the session cookie.',
  'get /auth/me': 'Return the calling user (id, org, email, permissions).',
  'post /auth/logout': 'Invalidate the current session and clear the cookie.',
  'get /datasets': 'List datasets in the active project.',
  'get /datasets/{id}/preview': 'Return the first rows of a dataset.',
  'get /ontology/object-types': 'List object types defined in the ontology.',
  'post /ontology/object-types': 'Create an object type backed by a dataset.',
  'get /ontology/object-types/{apiName}/objects': 'Resolve the live objects of a type.',
  'post /actions/{apiName}/execute': 'Execute an action against an object (writes an edit).',
};

function flatten(paths: Record<string, Record<string, unknown>> | undefined): Endpoint[] {
  if (!paths) return [];
  const out: Endpoint[] = [];
  for (const [path, ops] of Object.entries(paths)) {
    if (!ops || typeof ops !== 'object') continue;
    for (const method of Object.keys(ops)) {
      if (!HTTP_METHODS.includes(method.toLowerCase())) continue;
      const desc = DESCRIPTIONS[`${method.toLowerCase()} ${path}`];
      out.push(desc ? { method, path, desc } : { method, path });
    }
  }
  return out;
}

export function ApiSdkView() {
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [tokens, setTokens] = useState<ApiTokenSummary[]>([]);
  const [tokenName, setTokenName] = useState('');
  const [newToken, setNewToken] = useState<{ id: string; token: string } | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [err, setErr] = useState('');

  const refreshTokens = useCallback(() => {
    api.listApiTokens().then((r) => setTokens(r.tokens)).catch((e) => setErr((e as Error).message));
  }, []);

  useEffect(() => { api.openapiSpec().then((spec) => setEndpoints(flatten(spec.paths))).catch((e) => setErr((e as Error).message)); }, []);
  useEffect(() => { refreshTokens(); }, [refreshTokens]);

  async function createToken() {
    setErr('');
    if (!tokenName.trim()) { setErr('token name required'); return; }
    try {
      const r = await api.createApiToken(tokenName.trim());
      setNewToken(r);
      setTokenCopied(false);
      setTokenName('');
      refreshTokens();
    } catch (e) { setErr((e as Error).message); }
  }

  async function revokeToken(id: string) {
    setErr('');
    try {
      await api.deleteApiToken(id);
      if (newToken?.id === id) setNewToken(null);
      refreshTokens();
    } catch (e) { setErr((e as Error).message); }
  }

  return (
    <div className="card">
      <h2>API &amp; SDK</h2>
      <p style={{ color: 'var(--muted)' }}>
        Every surface here is backed by a REST API. The full OpenAPI 3.1 spec is served at{' '}
        <a href="/api/openapi/spec">/api/openapi/spec</a> (<a href="/api/openapi/spec">raw spec</a>). A typed client is generated
        from it via <code>pnpm gen:client</code> into the <code>@so/client</code> package. Authenticate programmatic calls with a
        personal API token via <code>Authorization: Bearer so_…</code>.
      </p>
      <h3>Endpoints</h3>
      <EndpointList endpoints={endpoints} />
      <h3>API tokens</h3>
      <p style={{ color: 'var(--muted)' }}>Personal tokens carry your permissions. Only a hash is stored — copy the token when it is shown.</p>
      <div className="field" style={{ display: 'flex', flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <input aria-label="token name" placeholder="Token name (e.g. ci)" value={tokenName} onChange={(e) => setTokenName(e.target.value)} />
        <button onClick={createToken}>Create token</button>
      </div>
      {newToken ? (
        <div style={{ margin: '10px 0' }}>
          <strong>Copy your token now — it will not be shown again.</strong>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
            <code aria-label="new api token">{newToken.token}</code>
            <button className="sec" aria-label="copy token" onClick={() => { void navigator.clipboard.writeText(newToken.token); setTokenCopied(true); }}>
              {tokenCopied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      ) : null}
      {tokens.length === 0 ? <p style={{ color: 'var(--muted)' }}>No tokens yet.</p> : (
        <table>
          <thead><tr><th>Name</th><th>Created</th><th>Last used</th><th></th></tr></thead>
          <tbody>
            {tokens.map((t) => (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td>{timeAgo(t.createdAt)}</td>
                <td>{t.lastUsedAt ? timeAgo(t.lastUsedAt) : 'never'}</td>
                <td><button className="sec" aria-label={`revoke token ${t.name}`} onClick={() => revokeToken(t.id)}>Revoke</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {err ? <div className="err">{err}</div> : null}
    </div>
  );
}
