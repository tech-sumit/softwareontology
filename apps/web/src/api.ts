export interface User { id: string; orgId: string; email: string; permissions: string[]; }
export interface ObjectTypeSummary { apiName: string; primaryKey: string; }
export interface PropertyMeta { apiName: string; type: string; }

async function req<T>(method: string, path: string, body?: unknown, asText = false): Promise<T> {
  const init: RequestInit = { method, credentials: 'include' };
  if (body !== undefined) {
    init.headers = { 'content-type': asText ? 'text/csv' : 'application/json' };
    init.body = asText ? (body as string) : JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, init);
  if (!res.ok) {
    const msg = await res.json().then((j) => j.error).catch(() => `HTTP ${res.status}`);
    throw new Error(msg);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const api = {
  login: (email: string, password: string) => req<{ ok: boolean }>('POST', '/auth/login', { email, password }),
  logout: () => req<{ ok: boolean }>('POST', '/auth/logout'),
  me: () => req<{ user: User }>('GET', '/auth/me'),
  uploadCsv: (name: string, csv: string) =>
    req<{ dataset: { id: string } }>('POST', `/datasets?name=${encodeURIComponent(name)}&format=csv`, csv, true),
  listObjectTypes: () => req<{ objectTypes: ObjectTypeSummary[] }>('GET', '/ontology/object-types'),
  getObjectType: (n: string) =>
    req<{ objectType: { apiName: string; primaryKey: string; properties: PropertyMeta[] } }>('GET', `/ontology/object-types/${n}`),
  createObjectType: (body: unknown) => req<{ objectType: unknown }>('POST', '/ontology/object-types', body),
  getObjects: (n: string) => req<{ objects: Record<string, unknown>[] }>('GET', `/ontology/object-types/${n}/objects`),
  listActions: () => req<{ actions: Array<{ apiName: string; objectType: string; kind: string }> }>('GET', '/actions/definitions'),
  createAction: (body: unknown) => req<{ ok: boolean }>('POST', '/actions/definitions', body),
  executeAction: (apiName: string, body: unknown) => req<{ ok: boolean }>('POST', `/actions/${apiName}/execute`, body),
  listUsers: () => req<{ users: Array<{ id: string; email: string; roles: string[] }> }>('GET', '/admin/users'),
  createUser: (email: string, password: string) => req<{ user: unknown }>('POST', '/admin/users', { email, password }),
};
