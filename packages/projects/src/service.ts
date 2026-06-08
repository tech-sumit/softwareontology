import { randomUUID } from 'node:crypto';
import type { ModuleContext } from '@so/sdk';

const NAME_RE = /^[A-Za-z0-9 _-]+$/;

export type ProjectRole = 'owner' | 'editor' | 'viewer';
const VALID_ROLES: ProjectRole[] = ['owner', 'editor', 'viewer'];
const RANK: Record<string, number> = { viewer: 1, editor: 2, owner: 3, admin: 4 };
export function roleAtLeast(role: string | null | undefined, min: string): boolean {
  return role != null && (RANK[role] ?? 0) >= (RANK[min] ?? 99);
}
export interface Member { userId: string; email: string; role: ProjectRole; }

export interface Project { id: string; name: string; description?: string; role?: ProjectRole | 'admin'; }

export function createProjectService(ctx: ModuleContext) {
  async function createProject(orgId: string, name: string, description?: string, creatorUserId?: string): Promise<string> {
    if (!name || !NAME_RE.test(name)) throw new Error('invalid project name');
    const existing = await ctx.db.query<{ id: string }>(`SELECT id FROM projects WHERE org_id = $1 AND name = $2`, [orgId, name]);
    if (existing[0]) return existing[0].id;
    const id = randomUUID();
    await ctx.db.query(`INSERT INTO projects(id,org_id,name,description) VALUES ($1,$2,$3,$4)`, [id, orgId, name, description ?? null]);
    if (creatorUserId) await ctx.db.query(`INSERT INTO project_members(project_id,user_id,role) VALUES ($1,$2,'owner') ON CONFLICT DO NOTHING`, [id, creatorUserId]);
    return id;
  }

  async function listProjects(orgId: string, userId: string, isAdmin: boolean): Promise<Project[]> {
    if (isAdmin) return ctx.db.query<Project>(`SELECT id, name, description, 'admin' AS role FROM projects WHERE org_id = $1 AND archived = false ORDER BY (id = 'project_default') DESC, name`, [orgId]);
    return ctx.db.query<Project>(`SELECT p.id, p.name, p.description, m.role FROM projects p JOIN project_members m ON m.project_id = p.id AND m.user_id = $2 WHERE p.org_id = $1 AND p.archived = false ORDER BY (p.id = 'project_default') DESC, p.name`, [orgId, userId]);
  }

  async function listArchivedProjects(orgId: string, userId: string, isAdmin: boolean): Promise<Project[]> {
    if (isAdmin) return ctx.db.query<Project>(`SELECT id, name, description, 'admin' AS role FROM projects WHERE org_id = $1 AND archived = true ORDER BY name`, [orgId]);
    return ctx.db.query<Project>(`SELECT p.id, p.name, p.description, m.role FROM projects p JOIN project_members m ON m.project_id = p.id AND m.user_id = $2 WHERE p.org_id = $1 AND p.archived = true ORDER BY p.name`, [orgId, userId]);
  }

  async function getProject(orgId: string, id: string, userId: string, isAdmin: boolean): Promise<Project | null> {
    const rows = await ctx.db.query<Project>(`SELECT id, name, description FROM projects WHERE org_id = $1 AND id = $2`, [orgId, id]);
    const p = rows[0];
    if (!p) return null;
    if (isAdmin) return { ...p, role: 'admin' };
    const role = await memberRole(id, userId);
    return role ? { ...p, role } : null;
  }

  async function updateProject(orgId: string, id: string, patch: { name?: string; description?: string }): Promise<Project | null> {
    if (patch.name !== undefined && (!patch.name || !NAME_RE.test(patch.name))) throw new Error('invalid project name');
    const sets: string[] = []; const vals: unknown[] = [];
    if (patch.name !== undefined) { vals.push(patch.name); sets.push(`name = $${vals.length}`); }
    if (patch.description !== undefined) { vals.push(patch.description); sets.push(`description = $${vals.length}`); }
    if (sets.length === 0) { const rows = await ctx.db.query<Project>(`SELECT id, name, description FROM projects WHERE org_id=$1 AND id=$2`, [orgId, id]); return rows[0] ?? null; }
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

  async function memberRole(projectId: string, userId: string): Promise<ProjectRole | null> {
    const rows = await ctx.db.query<{ role: ProjectRole }>(`SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2`, [projectId, userId]);
    return rows[0]?.role ?? null;
  }
  async function listMembers(projectId: string): Promise<Member[]> {
    return ctx.db.query<Member>(`SELECT m.user_id AS "userId", u.email, m.role FROM project_members m JOIN users u ON u.id = m.user_id WHERE m.project_id = $1 ORDER BY u.email`, [projectId]);
  }
  async function listCandidates(orgId: string, projectId: string): Promise<Array<{ id: string; email: string }>> {
    return ctx.db.query<{ id: string; email: string }>(`SELECT id, email FROM users WHERE org_id = $1 AND id NOT IN (SELECT user_id FROM project_members WHERE project_id = $2) ORDER BY email`, [orgId, projectId]);
  }
  async function countOwners(projectId: string): Promise<number> {
    const r = await ctx.db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM project_members WHERE project_id = $1 AND role = 'owner'`, [projectId]);
    return Number(r[0]?.n ?? 0);
  }
  async function addMember(projectId: string, userId: string, role: ProjectRole): Promise<void> {
    if (!VALID_ROLES.includes(role)) throw new Error('invalid role');
    await ctx.db.query(`INSERT INTO project_members(project_id,user_id,role) VALUES ($1,$2,$3) ON CONFLICT (project_id,user_id) DO UPDATE SET role = EXCLUDED.role`, [projectId, userId, role]);
  }
  async function setMemberRole(projectId: string, userId: string, role: ProjectRole): Promise<boolean> {
    if (!VALID_ROLES.includes(role)) throw new Error('invalid role');
    const current = await memberRole(projectId, userId);
    if (!current) return false;
    if (current === 'owner' && role !== 'owner' && (await countOwners(projectId)) <= 1) throw new Error('a project must keep at least one owner');
    const r = await ctx.db.query<{ user_id: string }>(`UPDATE project_members SET role = $3 WHERE project_id = $1 AND user_id = $2 RETURNING user_id`, [projectId, userId, role]);
    return Boolean(r[0]);
  }
  async function removeMember(projectId: string, userId: string): Promise<boolean> {
    const current = await memberRole(projectId, userId);
    if (!current) return false;
    if (current === 'owner' && (await countOwners(projectId)) <= 1) throw new Error('a project must keep at least one owner');
    const r = await ctx.db.query<{ user_id: string }>(`DELETE FROM project_members WHERE project_id = $1 AND user_id = $2 RETURNING user_id`, [projectId, userId]);
    return Boolean(r[0]);
  }

  return { createProject, listProjects, getProject, listArchivedProjects, updateProject, setArchived, memberRole, listMembers, listCandidates, addMember, setMemberRole, removeMember };
}
