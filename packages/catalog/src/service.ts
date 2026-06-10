import type { ModuleContext } from '@so/sdk';

export interface AuditEntry { actor: string | null; actorEmail: string | null; action: string; objectType: string; primaryKey: string | null; createdAt: string; }
export interface SearchHit { kind: string; name: string; }

export function createCatalogService(ctx: ModuleContext) {
  async function audit(orgId: string, filters: { action?: string; objectType?: string; limit?: number; offset?: number }): Promise<AuditEntry[]> {
    const where: string[] = ['a.org_id = $1'];
    const params: unknown[] = [orgId];
    if (filters.action) { params.push(filters.action); where.push(`a.action = $${params.length}`); }
    if (filters.objectType) { params.push(filters.objectType); where.push(`a.object_type = $${params.length}`); }
    const limit = Math.min(Math.max(Math.trunc(Number(filters.limit ?? 50)) || 50, 1), 200);
    const offset = Math.max(Math.trunc(Number(filters.offset ?? 0)) || 0, 0);
    params.push(limit);
    const limitParam = params.length;
    params.push(offset);
    const offsetParam = params.length;
    const rows = await ctx.db.query<{ actor: string | null; actor_email: string | null; action: string; object_type: string; primary_key: string | null; created_at: string }>(
      `SELECT a.actor, COALESCE(u.email, a.actor) AS actor_email, a.action, a.object_type, a.primary_key, a.created_at
       FROM audit_log a LEFT JOIN users u ON u.id = a.actor AND u.org_id = a.org_id
       WHERE ${where.join(' AND ')} ORDER BY a.created_at DESC LIMIT $${limitParam} OFFSET $${offsetParam}`,
      params,
    );
    return rows.map((r) => ({ actor: r.actor, actorEmail: r.actor_email, action: r.action, objectType: r.object_type, primaryKey: r.primary_key, createdAt: r.created_at }));
  }

  async function search(orgId: string, q: string): Promise<SearchHit[]> {
    const like = `%${q}%`;
    const rows = await ctx.db.query<{ kind: string; name: string }>(
      `SELECT 'objectType' AS kind, api_name AS name FROM object_types WHERE org_id = $1 AND api_name ILIKE $2
       UNION ALL SELECT 'dataset' AS kind, name FROM datasets WHERE org_id = $1 AND name ILIKE $2
       UNION ALL SELECT 'action' AS kind, api_name AS name FROM action_defs WHERE org_id = $1 AND api_name ILIKE $2
       ORDER BY kind, name LIMIT 50`,
      [orgId, like],
    );
    return rows.map((r) => ({ kind: r.kind, name: r.name }));
  }

  return { audit, search };
}
