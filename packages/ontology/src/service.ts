import { randomUUID } from 'node:crypto';
import type { ModuleContext } from '@so/sdk';
import { resolveObjectSet, type ObjectTypeMapping, type PropType, type Filter } from '@so/query';
import { createDatasetService } from '@so/datasets';

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const VALID_TYPES: ReadonlySet<string> = new Set(['string', 'int', 'float', 'bool', 'timestamp']);

export interface PropertyInput { apiName: string; column: string; type: PropType; }
export interface ObjectTypeInput { apiName: string; datasetId: string; primaryKey: string; properties: PropertyInput[]; }
export interface ObjectTypeSummary { apiName: string; datasetId: string; primaryKey: string; }
export interface ObjectTypeDetail extends ObjectTypeSummary { id: string; objectKey: string; properties: PropertyInput[]; functions: FunctionInput[]; }
export interface FunctionInput { apiName: string; expression: string; type: PropType; }

export function createOntologyService(ctx: ModuleContext) {
  const datasets = createDatasetService(ctx);

  function validate(input: ObjectTypeInput): void {
    if (!NAME_RE.test(input.apiName)) throw new Error(`invalid object type name: ${input.apiName}`);
    if (input.properties.length === 0) throw new Error('at least one property required');
    for (const p of input.properties) {
      if (!NAME_RE.test(p.apiName)) throw new Error(`invalid property name: ${p.apiName}`);
      if (!NAME_RE.test(p.column)) throw new Error(`invalid column name: ${p.column}`);
      if (!VALID_TYPES.has(p.type)) throw new Error(`invalid prop type: ${p.type}`);
    }
    if (!input.properties.some((p) => p.apiName === input.primaryKey)) {
      throw new Error(`primaryKey '${input.primaryKey}' must be one of the properties`);
    }
  }

  async function createObjectType(orgId: string, input: ObjectTypeInput): Promise<ObjectTypeSummary> {
    validate(input);
    const ds = await datasets.get(orgId, input.datasetId);
    if (!ds) throw new Error(`dataset not found: ${input.datasetId}`);
    const id = randomUUID();
    await ctx.db.query(
      `INSERT INTO object_types(id,org_id,api_name,dataset_id,primary_key) VALUES ($1,$2,$3,$4,$5)`,
      [id, orgId, input.apiName, input.datasetId, input.primaryKey],
    );
    for (let i = 0; i < input.properties.length; i++) {
      const p = input.properties[i]!;
      await ctx.db.query(
        `INSERT INTO object_properties(object_type_id,ordinal,api_name,column_name,prop_type) VALUES ($1,$2,$3,$4,$5)`,
        [id, i, p.apiName, p.column, p.type],
      );
    }
    return { apiName: input.apiName, datasetId: input.datasetId, primaryKey: input.primaryKey };
  }

  async function listObjectTypes(orgId: string): Promise<ObjectTypeSummary[]> {
    const rows = await ctx.db.query<{ api_name: string; dataset_id: string; primary_key: string }>(
      `SELECT api_name, dataset_id, primary_key FROM object_types WHERE org_id = $1 ORDER BY api_name`,
      [orgId],
    );
    return rows.map((r) => ({ apiName: r.api_name, datasetId: r.dataset_id, primaryKey: r.primary_key }));
  }

  async function getObjectType(orgId: string, apiName: string): Promise<ObjectTypeDetail | null> {
    const rows = await ctx.db.query<{ id: string; dataset_id: string; primary_key: string }>(
      `SELECT id, dataset_id, primary_key FROM object_types WHERE org_id = $1 AND api_name = $2`,
      [orgId, apiName],
    );
    const r = rows[0];
    if (!r) return null;
    const props = await ctx.db.query<{ api_name: string; column_name: string; prop_type: string }>(
      `SELECT api_name, column_name, prop_type FROM object_properties WHERE object_type_id = $1 ORDER BY ordinal`,
      [r.id],
    );
    const fns = await ctx.db.query<{ api_name: string; expression: string; prop_type: string }>(
      `SELECT api_name, expression, prop_type FROM object_functions WHERE object_type_id = $1 ORDER BY ordinal`,
      [r.id],
    );
    const ds = await datasets.get(orgId, r.dataset_id);
    if (!ds) throw new Error(`backing dataset missing for object type ${apiName}`);
    return {
      id: r.id, apiName, datasetId: r.dataset_id, primaryKey: r.primary_key, objectKey: ds.objectKey,
      properties: props.map((p) => ({ apiName: p.api_name, column: p.column_name, type: p.prop_type as PropType })),
      functions: fns.map((f) => ({ apiName: f.api_name, expression: f.expression, type: f.prop_type as PropType })),
    };
  }

  async function createLinkType(
    orgId: string,
    input: { apiName: string; fromObjectType: string; toObjectType: string; foreignKeyProperty: string },
  ): Promise<void> {
    if (!NAME_RE.test(input.apiName)) throw new Error(`invalid link name: ${input.apiName}`);
    const from = await getObjectType(orgId, input.fromObjectType);
    const to = await getObjectType(orgId, input.toObjectType);
    if (!from || !to) throw new Error('from/to object type not found');
    await ctx.db.query(
      `INSERT INTO link_types(id,org_id,api_name,from_object_type_id,to_object_type_id,foreign_key_property)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [randomUUID(), orgId, input.apiName, from.id, to.id, input.foreignKeyProperty],
    );
  }

  async function createFunction(orgId: string, objectType: string, input: FunctionInput): Promise<void> {
    if (!NAME_RE.test(input.apiName)) throw new Error(`invalid function name: ${input.apiName}`);
    if (!VALID_TYPES.has(input.type)) throw new Error(`invalid type: ${input.type}`);
    const ot = await getObjectType(orgId, objectType);
    if (!ot) throw new Error(`object type not found: ${objectType}`);
    const ordinal = ot.functions.length;
    await ctx.db.query(
      `INSERT INTO object_functions(object_type_id,ordinal,api_name,expression,prop_type) VALUES ($1,$2,$3,$4,$5)`,
      [ot.id, ordinal, input.apiName, input.expression, input.type],
    );
  }

  async function resolveObjects(
    orgId: string,
    apiName: string,
    options?: { filters?: Filter[]; limit?: number; offset?: number },
  ): Promise<Record<string, unknown>[]> {
    const ot = await getObjectType(orgId, apiName);
    if (!ot) throw new Error(`object type not found: ${apiName}`);
    const mapping: ObjectTypeMapping = {
      objectType: ot.apiName,
      primaryKey: ot.primaryKey,
      properties: ot.properties.map((p) => ({ name: p.apiName, column: p.column, type: p.type })),
      functions: ot.functions.map((f) => ({ name: f.apiName, expression: f.expression, type: f.type })),
      backing: { kind: 's3', path: ctx.objectStore.getObjectUrl(ot.objectKey) },
    };
    const rows = await resolveObjectSet({
      mapping,
      pgConnString: ctx.config.require('DATABASE_URL'),
      s3: {
        endpoint: ctx.config.require('S3_ENDPOINT'),
        accessKeyId: ctx.config.require('S3_ACCESS_KEY_ID'),
        secretAccessKey: ctx.config.require('S3_SECRET_ACCESS_KEY'),
        region: ctx.config.get('S3_REGION') ?? 'us-east-1',
        useSsl: ctx.config.get('S3_USE_SSL') === 'true',
      },
      options: options ?? {},
    });
    // DuckDB returns 64-bit columns (e.g. a CSV-inferred BIGINT `seats`) as JS
    // BigInt, which JSON.stringify cannot serialize. The ontology `int` PropType
    // is a 32-bit JS number, so coerce BigInt cells to Number for the typed API.
    return rows.map((row) => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) out[k] = typeof v === 'bigint' ? Number(v) : v;
      return out;
    });
  }

  return { createObjectType, listObjectTypes, getObjectType, createLinkType, resolveObjects, createFunction };
}
