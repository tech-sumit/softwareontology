import { randomUUID } from 'node:crypto';
import type { ModuleContext } from '@so/sdk';

const NAME_RE = /^[A-Za-z0-9 _-]+$/;

export interface Project { id: string; name: string; description?: string; }

export function createProjectService(ctx: ModuleContext) {
  async function createProject(orgId: string, name: string, description?: string): Promise<string> {
    if (!name || !NAME_RE.test(name)) throw new Error('invalid project name');
    const existing = await ctx.db.query<{ id: string }>(`SELECT id FROM projects WHERE org_id = $1 AND name = $2`, [orgId, name]);
    if (existing[0]) return existing[0].id;
    const id = randomUUID();
    await ctx.db.query(`INSERT INTO projects(id,org_id,name,description) VALUES ($1,$2,$3,$4)`, [id, orgId, name, description ?? null]);
    return id;
  }

  async function listProjects(orgId: string): Promise<Project[]> {
    return ctx.db.query<Project>(`SELECT id, name, description FROM projects WHERE org_id = $1 AND archived = false ORDER BY (id = 'project_default') DESC, name`, [orgId]);
  }

  async function listArchivedProjects(orgId: string): Promise<Project[]> {
    return ctx.db.query<Project>(`SELECT id, name, description FROM projects WHERE org_id = $1 AND archived = true ORDER BY name`, [orgId]);
  }

  async function getProject(orgId: string, id: string): Promise<Project | null> {
    const rows = await ctx.db.query<Project>(`SELECT id, name, description FROM projects WHERE org_id = $1 AND id = $2`, [orgId, id]);
    return rows[0] ?? null;
  }

  async function updateProject(orgId: string, id: string, patch: { name?: string; description?: string }): Promise<Project | null> {
    if (patch.name !== undefined && (!patch.name || !NAME_RE.test(patch.name))) throw new Error('invalid project name');
    const sets: string[] = []; const vals: unknown[] = [];
    if (patch.name !== undefined) { vals.push(patch.name); sets.push(`name = $${vals.length}`); }
    if (patch.description !== undefined) { vals.push(patch.description); sets.push(`description = $${vals.length}`); }
    if (sets.length === 0) return getProject(orgId, id);
    vals.push(orgId); const orgIdx = vals.length;
    vals.push(id); const idIdx = vals.length;
    const rows = await ctx.db.query<Project>(`UPDATE projects SET ${sets.join(', ')} WHERE org_id = $${orgIdx} AND id = $${idIdx} RETURNING id, name, description`, vals);
    return rows[0] ?? null;
  }

  async function setArchived(orgId: string, id: string, archived: boolean): Promise<boolean> {
    if (id === 'project_default') throw new Error('the Default project cannot be archived');
    const rows = await ctx.db.query<{ id: string }>(`UPDATE projects SET archived = $1 WHERE org_id = $2 AND id = $3 RETURNING id`, [archived, orgId, id]);
    return Boolean(rows[0]);
  }

  return { createProject, listProjects, getProject, listArchivedProjects, updateProject, setArchived };
}
