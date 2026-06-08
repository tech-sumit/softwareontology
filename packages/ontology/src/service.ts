import { randomUUID } from 'node:crypto';
import type { ModuleContext } from '@so/sdk';
import { resolveObjectSet, type ObjectTypeMapping, type PropType, type Filter } from '@so/query';
import { createDatasetService } from '@so/datasets';

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const BRANCH_RE = /^[A-Za-z0-9_-]+$/;
const VALID_TYPES: ReadonlySet<string> = new Set(['string', 'int', 'float', 'bool', 'timestamp']);

export interface PropertyInput { apiName: string; column: string; type: PropType; requiredPermission?: string | null; }
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
    const props = await ctx.db.query<{ api_name: string; column_name: string; prop_type: string; required_permission: string | null }>(
      `SELECT api_name, column_name, prop_type, required_permission FROM object_properties WHERE object_type_id = $1 ORDER BY ordinal`,
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
      properties: props.map((p) => ({ apiName: p.api_name, column: p.column_name, type: p.prop_type as PropType, requiredPermission: p.required_permission })),
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

  async function resolveLinkedObjects(orgId: string, fromType: string, fromPk: string, linkApiName: string, branch = 'main'): Promise<Record<string, unknown>[]> {
    const fromOt = await getObjectType(orgId, fromType);
    if (!fromOt) throw new Error(`object type not found: ${fromType}`);
    const links = await ctx.db.query<{ to_object_type_id: string; foreign_key_property: string }>(
      `SELECT to_object_type_id, foreign_key_property FROM link_types WHERE org_id = $1 AND from_object_type_id = $2 AND api_name = $3`,
      [orgId, fromOt.id, linkApiName],
    );
    const link = links[0];
    if (!link) throw new Error(`link not found: ${linkApiName}`);
    const toRows = await ctx.db.query<{ api_name: string }>(`SELECT api_name FROM object_types WHERE id = $1`, [link.to_object_type_id]);
    const toApiName = toRows[0]?.api_name;
    if (!toApiName) throw new Error('target object type missing');
    const toOt = await getObjectType(orgId, toApiName);
    if (!toOt) throw new Error('target object type missing');

    const fromObjs = await resolveObjects(orgId, fromType, { filters: [{ property: fromOt.primaryKey, op: '=', value: fromPk }], branch });
    const fromObj = fromObjs[0];
    if (!fromObj) return [];
    const fkValue = fromObj[link.foreign_key_property];
    if (fkValue === null || fkValue === undefined) return [];

    return resolveObjects(orgId, toApiName, { filters: [{ property: toOt.primaryKey, op: '=', value: fkValue as string | number | boolean }], branch });
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

  async function listLinkTypes(
    orgId: string,
  ): Promise<Array<{ apiName: string; fromObjectType: string; toObjectType: string; foreignKeyProperty: string }>> {
    // link_types stores object-type *ids* (from_object_type_id / to_object_type_id);
    // join object_types to surface the api_names callers expect.
    return ctx.db.query<{ apiName: string; fromObjectType: string; toObjectType: string; foreignKeyProperty: string }>(
      `SELECT lt.api_name AS "apiName",
              f.api_name AS "fromObjectType",
              t.api_name AS "toObjectType",
              lt.foreign_key_property AS "foreignKeyProperty"
       FROM link_types lt
       JOIN object_types f ON f.id = lt.from_object_type_id
       JOIN object_types t ON t.id = lt.to_object_type_id
       WHERE lt.org_id = $1
       ORDER BY lt.api_name`,
      [orgId],
    );
  }

  async function setPropertySecurity(orgId: string, objectType: string, propertyApiName: string, requiredPermission: string | null): Promise<void> {
    const ot = await getObjectType(orgId, objectType);
    if (!ot) throw new Error(`object type not found: ${objectType}`);
    if (!ot.properties.some((p) => p.apiName === propertyApiName)) throw new Error(`property not found: ${propertyApiName}`);
    await ctx.db.query(
      `UPDATE object_properties SET required_permission = $1 WHERE object_type_id = $2 AND api_name = $3`,
      [requiredPermission, ot.id, propertyApiName],
    );
  }

  async function resolveObjects(
    orgId: string,
    apiName: string,
    options?: { filters?: Filter[]; limit?: number; offset?: number; branch?: string },
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

  async function listBranches(orgId: string): Promise<Array<{ name: string; status: string; createdAt: string | null }>> {
    const rows = await ctx.db.query<{ name: string; status: string; created_at: string }>(`SELECT name, status, created_at FROM branches WHERE org_id = $1 ORDER BY created_at DESC`, [orgId]);
    return [{ name: 'main', status: 'main', createdAt: null }, ...rows.map((r) => ({ name: r.name, status: r.status, createdAt: r.created_at }))];
  }
  async function createBranch(orgId: string, name: string, createdBy: string): Promise<void> {
    if (!BRANCH_RE.test(name) || name === 'main') throw new Error('invalid branch name');
    await ctx.db.query(`INSERT INTO branches(id,org_id,name,created_by) VALUES ($1,$2,$3,$4) ON CONFLICT (org_id,name) DO NOTHING`, [randomUUID(), orgId, name, createdBy]);
  }
  async function diffBranch(orgId: string, name: string): Promise<{ edits: Array<{ objectType: string; primaryKey: string; property: string; value: string | null }>; creates: Array<{ objectType: string; primaryKey: string }> }> {
    if (!BRANCH_RE.test(name)) throw new Error('invalid branch name');
    const edits = await ctx.db.query<{ object_type: string; primary_key: string; property: string; value: string | null }>(
      `SELECT object_type, primary_key, property, value FROM object_writeback w WHERE org_id=$1 AND branch=$2
         AND version = (SELECT MAX(version) FROM object_writeback w2 WHERE w2.org_id=w.org_id AND w2.object_type=w.object_type AND w2.primary_key=w.primary_key AND w2.property=w.property AND w2.branch=$2)
       ORDER BY object_type, primary_key, property`, [orgId, name]);
    const creates = await ctx.db.query<{ object_type: string; primary_key: string }>(
      `SELECT object_type, primary_key FROM object_created WHERE org_id=$1 AND branch=$2 ORDER BY object_type, primary_key`, [orgId, name]);
    return {
      edits: edits.map((e) => ({ objectType: e.object_type, primaryKey: e.primary_key, property: e.property, value: e.value })),
      creates: creates.map((c) => ({ objectType: c.object_type, primaryKey: c.primary_key })),
    };
  }
  async function mergeBranch(orgId: string, name: string, actor: string): Promise<{ merged: number }> {
    if (!BRANCH_RE.test(name) || name === 'main') throw new Error('cannot merge this branch');
    let merged = 0;
    await ctx.db.transaction(async (tx) => {
      const edits = await tx.query<{ object_type: string; primary_key: string; property: string; value: string | null }>(
        `SELECT object_type, primary_key, property, value FROM object_writeback w WHERE org_id=$1 AND branch=$2
           AND version = (SELECT MAX(version) FROM object_writeback w2 WHERE w2.org_id=w.org_id AND w2.object_type=w.object_type AND w2.primary_key=w.primary_key AND w2.property=w.property AND w2.branch=$2)`, [orgId, name]);
      for (const e of edits) {
        const v = await tx.query<{ v: number }>(`SELECT COALESCE(MAX(version),0)+1 AS v FROM object_writeback WHERE org_id=$1 AND object_type=$2 AND primary_key=$3 AND property=$4`, [orgId, e.object_type, e.primary_key, e.property]);
        await tx.query(`INSERT INTO object_writeback(org_id,object_type,primary_key,property,value,version,branch,updated_by) VALUES ($1,$2,$3,$4,$5,$6,'main',$7)`, [orgId, e.object_type, e.primary_key, e.property, e.value, Number(v[0]?.v ?? 1), actor]);
        merged++;
      }
      const creates = await tx.query<{ object_type: string; primary_key: string; payload: unknown }>(`SELECT object_type, primary_key, payload FROM object_created WHERE org_id=$1 AND branch=$2`, [orgId, name]);
      for (const c of creates) {
        await tx.query(`INSERT INTO object_created(org_id,object_type,primary_key,payload,branch,created_by) VALUES ($1,$2,$3,$4,'main',$5) ON CONFLICT (org_id,object_type,primary_key,branch) DO UPDATE SET payload=EXCLUDED.payload`, [orgId, c.object_type, c.primary_key, JSON.stringify(c.payload), actor]);
        merged++;
      }
      await tx.query(`UPDATE branches SET status='merged' WHERE org_id=$1 AND name=$2`, [orgId, name]);
    });
    return { merged };
  }
  async function deleteBranch(orgId: string, name: string): Promise<void> {
    if (!BRANCH_RE.test(name) || name === 'main') throw new Error('cannot delete this branch');
    await ctx.db.transaction(async (tx) => {
      await tx.query(`DELETE FROM object_writeback WHERE org_id=$1 AND branch=$2`, [orgId, name]);
      await tx.query(`DELETE FROM object_created WHERE org_id=$1 AND branch=$2`, [orgId, name]);
      await tx.query(`DELETE FROM branches WHERE org_id=$1 AND name=$2`, [orgId, name]);
    });
  }

  return { createObjectType, listObjectTypes, getObjectType, createLinkType, listLinkTypes, resolveObjects, createFunction, setPropertySecurity, resolveLinkedObjects, listBranches, createBranch, diffBranch, mergeBranch, deleteBranch };
}
