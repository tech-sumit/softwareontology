export const openapiSpec = {
  openapi: '3.1.0',
  info: { title: 'SoftwareOntology API', version: '1.0.0', description: 'Open-source Foundry-alternative platform API' },
  servers: [{ url: '/api' }],
  paths: {
    '/auth/login': { post: { operationId: 'login', requestBody: jsonBody({ email: str(), password: str() }, ['email', 'password']), responses: ok({ ok: bool() }) } },
    '/auth/me': { get: { operationId: 'me', responses: ok({ user: ref('User') }) } },
    '/auth/logout': { post: { operationId: 'logout', responses: ok({ ok: bool() }) } },
    '/datasets': { get: { operationId: 'listDatasets', responses: ok({ datasets: arr(ref('Dataset')) }) } },
    '/datasets/{id}/preview': { get: { operationId: 'previewDataset', parameters: [pathParam('id')], responses: ok({ rows: arr(obj()) }) } },
    '/ontology/object-types': {
      get: { operationId: 'listObjectTypes', responses: ok({ objectTypes: arr(ref('ObjectTypeSummary')) }) },
      post: { operationId: 'createObjectType', requestBody: jsonBody({ apiName: str(), datasetId: str(), primaryKey: str(), properties: arr(ref('PropertyInput')) }, ['apiName', 'datasetId', 'primaryKey', 'properties']), responses: created({ objectType: ref('ObjectTypeSummary') }) },
    },
    '/ontology/object-types/{apiName}/objects': { get: { operationId: 'getObjects', parameters: [pathParam('apiName')], responses: ok({ objects: arr(obj()) }) } },
    '/actions/{apiName}/execute': { post: { operationId: 'executeAction', parameters: [pathParam('apiName')], requestBody: jsonBody({ primaryKey: str(), edits: obj() }, ['primaryKey']), responses: ok({ ok: bool() }) } },
  },
  components: {
    schemas: {
      User: object({ id: str(), orgId: str(), email: str(), permissions: arr(str()) }, ['id', 'orgId', 'email', 'permissions']),
      Dataset: object({ id: str(), name: str(), rowCount: num() }, ['id', 'name', 'rowCount']),
      ObjectTypeSummary: object({ apiName: str(), primaryKey: str() }, ['apiName', 'primaryKey']),
      PropertyInput: object({ apiName: str(), column: str(), type: str() }, ['apiName', 'column', 'type']),
    },
  },
} as const;

// minimal OpenAPI schema helpers (kept tiny + typed-friendly for openapi-typescript)
function str() { return { type: 'string' } as const; }
function num() { return { type: 'number' } as const; }
function bool() { return { type: 'boolean' } as const; }
function obj() { return { type: 'object', additionalProperties: true } as const; }
function arr(items: object) { return { type: 'array', items }; }
function ref(name: string) { return { $ref: `#/components/schemas/${name}` }; }
function object(properties: Record<string, object>, required: string[]) { return { type: 'object', properties, required }; }
function pathParam(name: string) { return { name, in: 'path', required: true, schema: { type: 'string' } }; }
function jsonBody(properties: Record<string, object>, required: string[]) { return { required: true, content: { 'application/json': { schema: { type: 'object', properties, required } } } }; }
function ok(properties: Record<string, object>) { return { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'object', properties } } } } }; }
function created(properties: Record<string, object>) { return { '201': { description: 'created', content: { 'application/json': { schema: { type: 'object', properties } } } } }; }
