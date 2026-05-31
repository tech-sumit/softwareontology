import { randomUUID } from 'node:crypto';
import type { ModuleContext } from '@so/sdk';

const NAME_RE = /^[A-Za-z0-9 _-]+$/;

export interface Project { id: string; name: string; }

export function createProjectService(ctx: ModuleContext) {
  async function createProject(orgId: string, name: string): Promise<string> {
    if (!name || !NAME_RE.test(name)) throw new Error('invalid project name');
    const existing = await ctx.db.query<{ id: string }>(`SELECT id FROM projects WHERE org_id = $1 AND name = $2`, [orgId, name]);
    if (existing[0]) return existing[0].id;
    const id = randomUUID();
    await ctx.db.query(`INSERT INTO projects(id,org_id,name) VALUES ($1,$2,$3)`, [id, orgId, name]);
    return id;
  }

  async function listProjects(orgId: string): Promise<Project[]> {
    return ctx.db.query<Project>(`SELECT id, name FROM projects WHERE org_id = $1 ORDER BY (id = 'project_default') DESC, name`, [orgId]);
  }

  async function getProject(orgId: string, id: string): Promise<Project | null> {
    const rows = await ctx.db.query<Project>(`SELECT id, name FROM projects WHERE org_id = $1 AND id = $2`, [orgId, id]);
    return rows[0] ?? null;
  }

  return { createProject, listProjects, getProject };
}
