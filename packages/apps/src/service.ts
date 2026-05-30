import { randomUUID } from 'node:crypto';
import type { ModuleContext } from '@so/sdk';
import { validateDefinition, type AppDefinition } from './definition.js';

const NAME_RE = /^[A-Za-z0-9 _-]+$/;

export interface AppSummary { id: string; name: string; }
export interface AppRecord { id: string; name: string; definition: AppDefinition; }

export function createAppService(ctx: ModuleContext) {
  async function createApp(orgId: string, name: string, definition: unknown): Promise<string> {
    if (!name || !NAME_RE.test(name)) throw new Error('invalid app name');
    const def = validateDefinition(definition);
    const id = randomUUID();
    await ctx.db.query(`INSERT INTO apps(id,org_id,name,definition) VALUES ($1,$2,$3,$4)`, [id, orgId, name, JSON.stringify(def)]);
    return id;
  }
  async function listApps(orgId: string): Promise<AppSummary[]> {
    return ctx.db.query<AppSummary>(`SELECT id, name FROM apps WHERE org_id = $1 ORDER BY name`, [orgId]);
  }
  async function getApp(orgId: string, id: string): Promise<AppRecord | null> {
    const rows = await ctx.db.query<{ id: string; name: string; definition: AppDefinition }>(`SELECT id, name, definition FROM apps WHERE org_id = $1 AND id = $2`, [orgId, id]);
    const r = rows[0];
    return r ? { id: r.id, name: r.name, definition: r.definition } : null;
  }
  async function updateApp(orgId: string, id: string, patch: { name?: string; definition?: unknown }): Promise<boolean> {
    const existing = await getApp(orgId, id);
    if (!existing) return false;
    const name = patch.name ?? existing.name;
    if (!NAME_RE.test(name)) throw new Error('invalid app name');
    const def = patch.definition === undefined ? existing.definition : validateDefinition(patch.definition);
    await ctx.db.query(`UPDATE apps SET name=$1, definition=$2, updated_at=now() WHERE org_id=$3 AND id=$4`, [name, JSON.stringify(def), orgId, id]);
    return true;
  }
  async function deleteApp(orgId: string, id: string): Promise<boolean> {
    const rows = await ctx.db.query<{ id: string }>(`DELETE FROM apps WHERE org_id=$1 AND id=$2 RETURNING id`, [orgId, id]);
    return rows.length > 0;
  }
  return { createApp, listApps, getApp, updateApp, deleteApp };
}
