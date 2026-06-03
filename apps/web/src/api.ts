export interface User { id: string; orgId: string; email: string; permissions: string[]; }
export interface ObjectTypeSummary { apiName: string; primaryKey: string; }
export interface PropertyMeta { apiName: string; type: string; }
export interface AppWidget { id: string; type: string; title?: string; config: Record<string, unknown>; }
export interface AppDefinition { widgets: AppWidget[]; }
export interface ObjectTypeLineage { objectType: string; backingDataset: string | null; actions: string[]; links: string[]; }
export interface AuditEntry { actor: string | null; action: string; objectType: string; primaryKey: string | null; createdAt: string; }
export interface SearchHit { kind: string; name: string; }
export interface OpenApiSpec { paths: Record<string, Record<string, unknown>>; [key: string]: unknown; }

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
    req<{ objectType: { apiName: string; datasetId: string; primaryKey: string; properties: Array<{ apiName: string; column: string; type: string; requiredPermission?: string | null }>; functions: Array<{ apiName: string; expression: string; type: string }>; links: Array<{ apiName: string; fromObjectType: string; toObjectType: string; foreignKeyProperty: string }> } }>('GET', `/ontology/object-types/${n}`),
  getDataset: (id: string) => req<{ dataset: { id: string; name: string; columns: Array<{ name: string; duckType: string }> } }>('GET', `/datasets/${id}`),
  createObjectType: (body: unknown) => req<{ objectType: unknown }>('POST', '/ontology/object-types', body),
  createFunction: (objectType: string, body: { apiName: string; expression: string; type: string }) => req<{ ok: boolean }>('POST', `/ontology/object-types/${objectType}/functions`, body),
  createLinkType: (body: { apiName: string; fromObjectType: string; toObjectType: string; foreignKeyProperty: string }) => req<{ ok: boolean }>('POST', '/ontology/link-types', body),
  setPropertySecurity: (objectType: string, propName: string, requiredPermission: string | null) => req<{ ok: boolean }>('POST', `/ontology/object-types/${objectType}/properties/${propName}/security`, { requiredPermission }),
  listLinkTypes: () => req<{ linkTypes: Array<{ apiName: string; fromObjectType: string; toObjectType: string; foreignKeyProperty: string }> }>('GET', '/ontology/link-types'),
  getObjects: (n: string) => req<{ objects: Record<string, unknown>[] }>('GET', `/ontology/object-types/${n}/objects`),
  resolveLinkedObjects: (objectType: string, pk: string, linkApiName: string) => req<{ objects: Record<string, unknown>[] }>('GET', `/ontology/object-types/${objectType}/objects/${encodeURIComponent(pk)}/links/${linkApiName}`),
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
  // connectors — DB (Postgres): create { name, sourceConnString, sourceTable (schema.table) }
  listConnectorsDb: () => req<{ connectors: Array<{ id: string; name: string; sourceTable: string }> }>('GET', '/connectors-db'),
  createConnectorDb: (body: { name: string; sourceConnString: string; sourceTable: string }) => req<{ id: string }>('POST', '/connectors-db', body),
  syncConnectorDb: (id: string) => req<{ datasetId: string; rowCount: number }>('POST', `/connectors-db/${id}/sync`),
  // connectors — Cloud: list returns kind; create via /s3 ({ name, s3Url, format? }) or /rest ({ name, url, arrayPath? })
  listConnectorsCloud: () => req<{ connectors: Array<{ id: string; name: string; kind: string }> }>('GET', '/connectors-cloud'),
  createConnectorS3: (body: { name: string; s3Url: string; format?: string }) => req<{ id: string }>('POST', '/connectors-cloud/s3', body),
  createConnectorRest: (body: { name: string; url: string; arrayPath?: string }) => req<{ id: string }>('POST', '/connectors-cloud/rest', body),
  syncConnectorCloud: (id: string) => req<{ datasetId: string; rowCount: number }>('POST', `/connectors-cloud/${id}/sync`),
  // connectors — Airflow: create { name, provider, conn, query }
  listConnectorsAirflow: () => req<{ connectors: Array<{ id: string; name: string; provider: string }> }>('GET', '/connectors-airflow'),
  createConnectorAirflow: (body: { name: string; provider: string; conn: string; query: string }) => req<{ id: string }>('POST', '/connectors-airflow', body),
  syncConnectorAirflow: (id: string) => req<{ datasetId: string; rowCount: number }>('POST', `/connectors-airflow/${id}/sync`),
  // automations: create { name, triggerAction, thenAction, thenEdits? }
  listAutomations: () => req<{ automations: Array<{ id: string; name: string; triggerAction: string; thenAction: string }> }>('GET', '/automations'),
  createAutomation: (body: { name: string; triggerAction: string; thenAction: string; thenEdits?: Record<string, unknown> }) => req<{ id: string }>('POST', '/automations', body),
  // lineage: GET /lineage/object-types/:apiName → { lineage: { objectType, backingDataset, actions, links } }
  getLineage: (objectType: string) => req<{ lineage: ObjectTypeLineage }>('GET', `/lineage/object-types/${encodeURIComponent(objectType)}`),
  // catalog: audit → { entries: AuditEntry[] }; search → { hits: SearchHit[] }
  catalogAudit: () => req<{ entries: AuditEntry[] }>('GET', '/catalog/audit'),
  catalogSearch: (q: string) => req<{ hits: SearchHit[] }>('GET', `/catalog/search?q=${encodeURIComponent(q)}`),
  // openapi: full OpenAPI 3.1 doc keyed by path → { method: opObj }
  openapiSpec: () => req<OpenApiSpec>('GET', '/openapi/spec'),
};
