import { randomUUID } from 'node:crypto';
import type { ModuleContext } from '@so/sdk';
import { createOntologyService, type Principal } from '@so/ontology';

export interface Bucket { group: string; count: number; value?: number; }

export type MetricFn = 'count' | 'sum' | 'avg';

export interface Metric { fn: MetricFn; property?: string; }

export interface SavedDashboard {
  id: string;
  name: string;
  objectType: string;
  groupBy: string;
  fn: MetricFn;
  property: string | null;
  createdAt: string;
}

export function createDashboardService(ctx: ModuleContext) {
  const ontology = createOntologyService(ctx);

  async function aggregate(orgId: string, objectType: string, groupBy: string, principal?: Principal, metric?: Metric): Promise<Bucket[]> {
    const fn = metric?.fn ?? 'count';
    if ((fn === 'sum' || fn === 'avg') && !metric?.property) {
      throw new Error(`property is required for ${fn}`);
    }
    const objects = await ontology.resolveObjects(orgId, objectType, { limit: 10000, principal });
    const counts = new Map<string, number>();
    const sums = new Map<string, number>();
    const numCounts = new Map<string, number>();
    for (const o of objects) {
      const key = o[groupBy] === null || o[groupBy] === undefined ? '∅' : String(o[groupBy]);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (fn !== 'count') {
        const raw = o[metric!.property!];
        const n = raw === null || raw === undefined || raw === '' ? NaN : Number(raw);
        if (!Number.isNaN(n)) {
          sums.set(key, (sums.get(key) ?? 0) + n);
          numCounts.set(key, (numCounts.get(key) ?? 0) + 1);
        }
      }
    }
    const buckets = Array.from(counts, ([group, count]): Bucket => {
      if (fn === 'count') return { group, count };
      const sum = sums.get(group) ?? 0;
      const n = numCounts.get(group) ?? 0;
      const value = fn === 'sum' ? sum : n === 0 ? 0 : sum / n;
      return { group, count, value: Math.round(value * 10000) / 10000 };
    });
    return buckets.sort((a, b) => a.group.localeCompare(b.group));
  }

  async function saveDashboard(orgId: string, def: { name: string; objectType: string; groupBy: string; fn?: MetricFn; property?: string | null }, userId: string): Promise<string> {
    const id = randomUUID();
    const rows = await ctx.db.query<{ id: string }>(
      `INSERT INTO dashboards(id, org_id, name, object_type, group_by, fn, property, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (org_id, name) DO UPDATE
         SET object_type = EXCLUDED.object_type, group_by = EXCLUDED.group_by,
             fn = EXCLUDED.fn, property = EXCLUDED.property, created_by = EXCLUDED.created_by
       RETURNING id`,
      [id, orgId, def.name, def.objectType, def.groupBy, def.fn ?? 'count', def.property ?? null, userId],
    );
    return rows[0]!.id;
  }

  async function listDashboards(orgId: string): Promise<SavedDashboard[]> {
    const rows = await ctx.db.query<{ id: string; name: string; object_type: string; group_by: string; fn: string; property: string | null; created_at: string | Date }>(
      `SELECT id, name, object_type, group_by, fn, property, created_at FROM dashboards WHERE org_id = $1 ORDER BY name`,
      [orgId],
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      objectType: r.object_type,
      groupBy: r.group_by,
      fn: r.fn as MetricFn,
      property: r.property,
      createdAt: new Date(r.created_at).toISOString(),
    }));
  }

  async function deleteDashboard(orgId: string, id: string): Promise<void> {
    await ctx.db.query(`DELETE FROM dashboards WHERE org_id = $1 AND id = $2`, [orgId, id]);
  }

  return { aggregate, saveDashboard, listDashboards, deleteDashboard };
}
