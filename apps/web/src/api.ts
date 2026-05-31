export interface User { id: string; orgId: string; email: string; permissions: string[]; }
export interface ObjectTypeSummary { apiName: string; primaryKey: string; }
export interface PropertyMeta { apiName: string; type: string; }
export interface AppWidget { id: string; type: string; title?: string; config: Record<string, unknown>; }
export interface AppDefinition { widgets: AppWidget[]; }

let currentProjectId = 'project_default';
export function setActiveProject(id: string): void { currentProjectId = id; }
export function getActiveProject(): string { return currentProjectId; }

async function req<T>(method: string, path: string, body?: unknown, asText = false): Promise<T> {
  const headers: Record<string, string> = { 'x-project': currentProjectId };
  const init: RequestInit = { method, credentials: 'include', headers };
  if (body !== undefined) {
    headers['content-type'] = asText ? 'text/csv' : 'application/json';
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
  aggregate: (objectType: string, groupBy: string) => req<{ buckets: Array<{ group: string; count: number }> }>('POST', '/dashboards/aggregate', { objectType, groupBy }),
  ask: (objectType: string, question: string) => req<{ answer: string }>('POST', '/aip/ask', { objectType, question }),
  listApps: () => req<{ apps: Array<{ id: string; name: string }> }>('GET', '/apps'),
  getApp: (id: string) => req<{ id: string; name: string; definition: AppDefinition }>('GET', `/apps/${id}`),
  createApp: (name: string, definition: AppDefinition) => req<{ id: string }>('POST', '/apps', { name, definition }),
  updateApp: (id: string, body: { name?: string; definition?: AppDefinition }) => req<{ ok: boolean }>('PUT', `/apps/${id}`, body),
  deleteApp: (id: string) => req<{ ok: boolean }>('DELETE', `/apps/${id}`),
  listDatasets: () => req<{ datasets: Array<{ id: string; name: string; rowCount?: number }> }>('GET', '/datasets'),
  listProjects: () => req<{ projects: Array<{ id: string; name: string }> }>('GET', '/projects'),
  createProject: (name: string) => req<{ id: string }>('POST', '/projects', { name }),
  datasetPreview: (id: string) => req<{ rows: Record<string, unknown>[] }>('GET', `/datasets/${id}/preview`),
  listRoles: () => req<{ roles: Array<{ id: string; name: string }> }>('GET', '/admin/roles'),
  listMarkings: () => req<{ markings: Array<{ id: string; name: string }> }>('GET', '/governance/markings'),
  createMarking: (name: string) => req<{ id: string }>('POST', '/governance/markings', { name }),
  applyMarking: (markingId: string, datasetId: string) => req<{ ok: boolean }>('POST', `/governance/markings/${markingId}/datasets/${datasetId}`),
  grantMarking: (markingId: string, roleId: string) => req<{ ok: boolean }>('POST', `/governance/markings/${markingId}/roles/${roleId}`),
  myClearances: () => req<{ clearances: Array<{ id: string; name: string }> }>('GET', '/governance/me/clearances'),
  listPipelines: () => req<{ pipelines: Array<{ id: string; name: string; inputs: string[] }> }>('GET', '/pipelines'),
  createPipeline: (body: unknown) => req<{ id: string }>('POST', '/pipelines', body),
  runPipeline: (id: string) => req<{ datasetId: string; rowCount: number; runId: string }>('POST', `/pipelines/${id}/run`),
  pipelineRuns: (id: string) => req<{ runs: Array<{ id: string; status: string; trigger: string; rowCount: number | null; error: string | null; startedAt: string }> }>('GET', `/pipelines/${id}/runs`),
  setPipelineSchedule: (id: string, cron: string) => req<{ ok: boolean }>('PUT', `/pipelines/${id}/schedule`, { cron }),
  clearPipelineSchedule: (id: string) => req<{ ok: boolean }>('DELETE', `/pipelines/${id}/schedule`),
};
