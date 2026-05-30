import type { ModuleContext } from '@so/sdk';

export interface ObjectTypeLineage {
  objectType: string;
  backingDataset: string | null;
  actions: string[];
  links: string[];
}

export function createLineageService(ctx: ModuleContext) {
  async function forObjectType(orgId: string, apiName: string): Promise<ObjectTypeLineage | null> {
    const ot = await ctx.db.query<{ id: string; dataset_id: string }>(
      `SELECT id, dataset_id FROM object_types WHERE org_id = $1 AND api_name = $2`, [orgId, apiName],
    );
    if (!ot[0]) return null;
    const ds = await ctx.db.query<{ name: string }>(`SELECT name FROM datasets WHERE id = $1`, [ot[0].dataset_id]);
    const actions = await ctx.db.query<{ api_name: string }>(`SELECT api_name FROM action_defs WHERE org_id = $1 AND object_type = $2 ORDER BY api_name`, [orgId, apiName]);
    const links = await ctx.db.query<{ api_name: string }>(`SELECT api_name FROM link_types WHERE org_id = $1 AND (from_object_type_id = $2 OR to_object_type_id = $2) ORDER BY api_name`, [orgId, ot[0].id]);
    return { objectType: apiName, backingDataset: ds[0]?.name ?? null, actions: actions.map((a) => a.api_name), links: links.map((l) => l.api_name) };
  }
  return { forObjectType };
}
