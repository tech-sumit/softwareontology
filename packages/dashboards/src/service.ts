import type { ModuleContext } from '@so/sdk';
import { createOntologyService, type Principal } from '@so/ontology';

export interface Bucket { group: string; count: number; }

export function createDashboardService(ctx: ModuleContext) {
  const ontology = createOntologyService(ctx);
  async function aggregate(orgId: string, objectType: string, groupBy: string, principal?: Principal): Promise<Bucket[]> {
    const objects = await ontology.resolveObjects(orgId, objectType, { limit: 10000, principal });
    const counts = new Map<string, number>();
    for (const o of objects) {
      const key = o[groupBy] === null || o[groupBy] === undefined ? '∅' : String(o[groupBy]);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts, ([group, count]) => ({ group, count })).sort((a, b) => a.group.localeCompare(b.group));
  }
  return { aggregate };
}
