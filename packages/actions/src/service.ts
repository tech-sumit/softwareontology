import { randomUUID } from 'node:crypto';
import type { ModuleContext } from '@so/sdk';
import { createOntologyService } from '@so/ontology';

export type ActionKind = 'modify' | 'create';
export interface ActionDefInput { apiName: string; objectType: string; kind: ActionKind; }
export interface ExecuteInput { primaryKey: string; edits?: Record<string, unknown>; properties?: Record<string, unknown>; }

export function createActionService(ctx: ModuleContext) {
  const ontology = createOntologyService(ctx);

  async function createActionDef(orgId: string, input: ActionDefInput): Promise<void> {
    if (input.kind !== 'modify' && input.kind !== 'create') throw new Error('kind must be modify|create');
    const ot = await ontology.getObjectType(orgId, input.objectType);
    if (!ot) throw new Error(`object type not found: ${input.objectType}`);
    await ctx.db.query(
      `INSERT INTO action_defs(id,org_id,api_name,object_type,kind) VALUES ($1,$2,$3,$4,$5)`,
      [randomUUID(), orgId, input.apiName, input.objectType, input.kind],
    );
  }

  async function listActionDefs(orgId: string): Promise<ActionDefInput[]> {
    const rows = await ctx.db.query<{ api_name: string; object_type: string; kind: string }>(
      `SELECT api_name, object_type, kind FROM action_defs WHERE org_id = $1 ORDER BY api_name`,
      [orgId],
    );
    return rows.map((r) => ({ apiName: r.api_name, objectType: r.object_type, kind: r.kind as ActionKind }));
  }

  async function execute(orgId: string, actorId: string, apiName: string, input: ExecuteInput, branch = 'main'): Promise<void> {
    const defs = await ctx.db.query<{ object_type: string; kind: string }>(
      `SELECT object_type, kind FROM action_defs WHERE org_id = $1 AND api_name = $2`,
      [orgId, apiName],
    );
    const def = defs[0];
    if (!def) throw new Error(`action not found: ${apiName}`);
    if (!input.primaryKey) throw new Error('primaryKey required');

    const ot = await ontology.getObjectType(orgId, def.object_type);
    if (!ot) throw new Error(`object type not found: ${def.object_type}`);
    const propNames = new Set(ot.properties.map((p) => p.apiName));

    if (def.kind === 'modify') {
      const edits = input.edits ?? {};
      if (Object.keys(edits).length === 0) throw new Error('edits required for a modify action');
      for (const k of Object.keys(edits)) if (!propNames.has(k)) throw new Error(`unknown property: ${k}`);
      await ctx.db.transaction(async (tx) => {
        for (const [prop, value] of Object.entries(edits)) {
          const verRows = await tx.query<{ v: number }>(
            `SELECT COALESCE(MAX(version),0)+1 AS v FROM object_writeback
              WHERE org_id=$1 AND object_type=$2 AND primary_key=$3 AND property=$4`,
            [orgId, def.object_type, input.primaryKey, prop],
          );
          const version = Number(verRows[0]?.v ?? 1);
          await tx.query(
            `INSERT INTO object_writeback(org_id,object_type,primary_key,property,value,version,branch,updated_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [orgId, def.object_type, input.primaryKey, prop, String(value), version, branch, actorId],
          );
        }
        await tx.query(
          `INSERT INTO audit_log(id,org_id,actor,action,object_type,primary_key,params)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [randomUUID(), orgId, actorId, apiName, def.object_type, input.primaryKey, JSON.stringify(edits)],
        );
      });
    } else {
      const properties = input.properties ?? {};
      for (const k of Object.keys(properties)) if (!propNames.has(k)) throw new Error(`unknown property: ${k}`);
      await ctx.db.transaction(async (tx) => {
        await tx.query(
          `INSERT INTO object_created(org_id,object_type,primary_key,payload,branch,created_by) VALUES ($1,$2,$3,$4,$5,$6)`,
          [orgId, def.object_type, input.primaryKey, JSON.stringify(properties), branch, actorId],
        );
        await tx.query(
          `INSERT INTO audit_log(id,org_id,actor,action,object_type,primary_key,params)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [randomUUID(), orgId, actorId, apiName, def.object_type, input.primaryKey, JSON.stringify(properties)],
        );
      });
    }
    ctx.events.emit('action.executed', { orgId, apiName, primaryKey: input.primaryKey });
  }

  return { createActionDef, listActionDefs, execute };
}
