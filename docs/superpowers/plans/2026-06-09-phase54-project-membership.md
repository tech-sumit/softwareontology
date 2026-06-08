# Phase 54 — Project Membership (Access Boundary) Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps `- [ ]`.

**Goal:** Projects become an access boundary — per-project **members** with roles (owner/editor/viewer; org-`*` = admin), role-aware listing/get, owner-gated lifecycle + member CRUD, and a **Members** UI in Project Settings. Non-breaking backfill. (Spec: `docs/superpowers/specs/2026-06-09-project-membership-design.md`.)

**Architecture:** All membership lives in `@so/projects`. Global RBAC (`projects:read/write`) still gates *API access*; project **role** gates *which projects* + lifecycle/member-management. Phase B (per-resource enforcement in scoped modules) is deferred — this plan ships the `roleAtLeast` rank helper for it.

---

## Pre-flight
- [ ] **Branch:** `git checkout main && git checkout -b phase54/project-membership`

---

## Task 1: Backend — membership model (`@so/projects`)

**Files:** Modify `packages/projects/src/migrate.ts`, `packages/projects/src/service.ts`, `packages/projects/src/routes.ts`

### Step 1 — `migrate.ts`: append to `MIGRATIONS` (after the `archived` ALTER):
```ts
  `CREATE TABLE IF NOT EXISTS project_members (
    project_id text NOT NULL,
    user_id    text NOT NULL,
    role       text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, user_id)
  )`,
  `INSERT INTO project_members(project_id,user_id,role)
     SELECT p.id, u.id, 'editor' FROM projects p JOIN users u ON u.org_id = p.org_id
     ON CONFLICT DO NOTHING`,
  `UPDATE project_members SET role='owner'
     WHERE user_id IN (SELECT ur.user_id FROM user_roles ur
                       JOIN role_permissions rp ON rp.role_id = ur.role_id
                       WHERE rp.permission_key = '*')`,
```
(`auth` migrates before `projects`, so `users`/`user_roles`/`role_permissions` exist.)

### Step 2 — `service.ts`: READ the current file first. Keep `createProject`/`updateProject`/`setArchived` but apply the changes below. Add the role machinery at the top (after `NAME_RE`):
```ts
export type ProjectRole = 'owner' | 'editor' | 'viewer';
const VALID_ROLES: ProjectRole[] = ['owner', 'editor', 'viewer'];
const RANK: Record<string, number> = { viewer: 1, editor: 2, owner: 3, admin: 4 };
export function roleAtLeast(role: string | null | undefined, min: string): boolean {
  return role != null && (RANK[role] ?? 0) >= (RANK[min] ?? 99);
}
export interface Member { userId: string; email: string; role: ProjectRole; }
```
Change the `Project` interface to: `export interface Project { id: string; name: string; description?: string; role?: ProjectRole | 'admin'; }`

**`createProject`** — add a `creatorUserId` param and stamp owner. New signature/body:
```ts
  async function createProject(orgId: string, name: string, description?: string, creatorUserId?: string): Promise<string> {
    if (!name || !NAME_RE.test(name)) throw new Error('invalid project name');
    const existing = await ctx.db.query<{ id: string }>(`SELECT id FROM projects WHERE org_id = $1 AND name = $2`, [orgId, name]);
    if (existing[0]) return existing[0].id;
    const id = randomUUID();
    await ctx.db.query(`INSERT INTO projects(id,org_id,name,description) VALUES ($1,$2,$3,$4)`, [id, orgId, name, description ?? null]);
    if (creatorUserId) await ctx.db.query(`INSERT INTO project_members(project_id,user_id,role) VALUES ($1,$2,'owner') ON CONFLICT DO NOTHING`, [id, creatorUserId]);
    return id;
  }
```

**`listProjects` / `listArchivedProjects` / `getProject`** — replace with role-aware versions:
```ts
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
```

> **IMPORTANT:** if the existing `updateProject` has a no-edits branch that calls `getProject(orgId, id)` (Plan 53), it now has the WRONG arity. Change that branch to an inline select instead:
> ```ts
>     if (sets.length === 0) { const rows = await ctx.db.query<Project>(`SELECT id, name, description FROM projects WHERE org_id=$1 AND id=$2`, [orgId, id]); return rows[0] ?? null; }
> ```

Add these member functions before `return`:
```ts
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
```
And widen the return object to include: `memberRole, listMembers, listCandidates, addMember, setMemberRole, removeMember` (alongside the existing exports).

### Step 3 — `routes.ts`: replace the whole file with:
```ts
import type { FastifyPluginAsync } from 'fastify';
import { requirePermission } from '@so/auth';
import { createProjectService, roleAtLeast, type ProjectRole } from './service.js';

export const projectRoutes: FastifyPluginAsync = async (fastify) => {
  const svc = createProjectService(fastify.ctx);
  async function roleFor(perms: string[], userId: string, projectId: string): Promise<string | null> {
    return perms.includes('*') ? 'admin' : await svc.memberRole(projectId, userId);
  }

  fastify.post('/', { preHandler: requirePermission('projects:write') }, async (req, reply) => {
    const b = req.body as { name?: string; description?: string };
    if (!b?.name) return reply.code(400).send({ error: 'name required' });
    try { return reply.code(201).send({ id: await svc.createProject(req.user!.orgId, b.name, b.description, req.user!.id) }); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  fastify.get('/', { preHandler: requirePermission('projects:read') }, async (req) => ({ projects: await svc.listProjects(req.user!.orgId, req.user!.id, req.user!.permissions.includes('*')) }));
  fastify.get('/archived', { preHandler: requirePermission('projects:read') }, async (req) => ({ projects: await svc.listArchivedProjects(req.user!.orgId, req.user!.id, req.user!.permissions.includes('*')) }));

  fastify.get('/:id', { preHandler: requirePermission('projects:read') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = await svc.getProject(req.user!.orgId, id, req.user!.id, req.user!.permissions.includes('*'));
    return p ? reply.send(p) : reply.code(404).send({ error: 'project not found' });
  });

  fastify.patch('/:id', { preHandler: requirePermission('projects:write') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!roleAtLeast(await roleFor(req.user!.permissions, req.user!.id, id), 'owner')) return reply.code(403).send({ error: 'forbidden' });
    const b = (req.body ?? {}) as { name?: string; description?: string };
    try { const p = await svc.updateProject(req.user!.orgId, id, b); return p ? reply.send(p) : reply.code(404).send({ error: 'project not found' }); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  fastify.post('/:id/archive', { preHandler: requirePermission('projects:write') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!roleAtLeast(await roleFor(req.user!.permissions, req.user!.id, id), 'owner')) return reply.code(403).send({ error: 'forbidden' });
    try { const ok = await svc.setArchived(req.user!.orgId, id, true); return ok ? reply.send({ ok: true }) : reply.code(404).send({ error: 'project not found' }); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  fastify.post('/:id/restore', { preHandler: requirePermission('projects:write') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!roleAtLeast(await roleFor(req.user!.permissions, req.user!.id, id), 'owner')) return reply.code(403).send({ error: 'forbidden' });
    try { const ok = await svc.setArchived(req.user!.orgId, id, false); return ok ? reply.send({ ok: true }) : reply.code(404).send({ error: 'project not found' }); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  fastify.get('/:id/members', { preHandler: requirePermission('projects:read') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await roleFor(req.user!.permissions, req.user!.id, id))) return reply.code(403).send({ error: 'forbidden' });
    return reply.send({ members: await svc.listMembers(id) });
  });

  fastify.get('/:id/candidates', { preHandler: requirePermission('projects:write') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!roleAtLeast(await roleFor(req.user!.permissions, req.user!.id, id), 'owner')) return reply.code(403).send({ error: 'forbidden' });
    return reply.send({ users: await svc.listCandidates(req.user!.orgId, id) });
  });

  fastify.post('/:id/members', { preHandler: requirePermission('projects:write') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!roleAtLeast(await roleFor(req.user!.permissions, req.user!.id, id), 'owner')) return reply.code(403).send({ error: 'forbidden' });
    const b = req.body as { userId?: string; role?: string };
    if (!b?.userId || !b?.role) return reply.code(400).send({ error: 'userId and role required' });
    try { await svc.addMember(id, b.userId, b.role as ProjectRole); return reply.code(201).send({ ok: true }); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  fastify.patch('/:id/members/:userId', { preHandler: requirePermission('projects:write') }, async (req, reply) => {
    const { id, userId } = req.params as { id: string; userId: string };
    if (!roleAtLeast(await roleFor(req.user!.permissions, req.user!.id, id), 'owner')) return reply.code(403).send({ error: 'forbidden' });
    const b = req.body as { role?: string };
    if (!b?.role) return reply.code(400).send({ error: 'role required' });
    try { const ok = await svc.setMemberRole(id, userId, b.role as ProjectRole); return ok ? reply.send({ ok: true }) : reply.code(404).send({ error: 'member not found' }); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  fastify.delete('/:id/members/:userId', { preHandler: requirePermission('projects:write') }, async (req, reply) => {
    const { id, userId } = req.params as { id: string; userId: string };
    if (!roleAtLeast(await roleFor(req.user!.permissions, req.user!.id, id), 'owner')) return reply.code(403).send({ error: 'forbidden' });
    try { const ok = await svc.removeMember(id, userId); return ok ? reply.send({ ok: true }) : reply.code(404).send({ error: 'member not found' }); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });
};
```

- [ ] **Step 4: typecheck** `pnpm --filter @so/projects typecheck` → 0. Fix any drift between the existing service exports and the route's `svc.*` calls.

---

## Task 2: Membership integration test

**Files:** Modify `packages/projects/test/projects.int.test.ts`

- [ ] **Step 1** — import the admin module and add it to the shared `createServer` modules list (the first `it` calls `createServer`; later `it`s reuse `server`). Add `import adminModule from '@so/admin';` and change the modules array in the FIRST `it` to `[authModule, projectsModule, adminModule]`. (`@so/admin` is already a workspace dep of nothing here — if the import path/dep is missing, add `@so/admin` to `packages/projects/package.json` devDependencies as `workspace:*`.)

- [ ] **Step 2** — append a new `it` inside the existing `describe`:
```ts
  it('enforces membership: visibility, owner-gated lifecycle & members, last-owner guard', async () => {
    const db = server.kernel.ctx.db;
    // clean slate for this test's fixtures
    await db.query(`DELETE FROM project_members WHERE user_id IN (SELECT id FROM users WHERE email='member@example.com')`);
    await db.query(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email='member@example.com')`);
    await db.query(`DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE email='member@example.com')`);
    await db.query(`DELETE FROM users WHERE email='member@example.com'`);
    await db.query(`DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE name='projuser')`);
    await db.query(`DELETE FROM roles WHERE name='projuser'`);
    await db.query(`DELETE FROM project_members WHERE project_id IN (SELECT id FROM projects WHERE name='Members')`);
    await db.query(`DELETE FROM projects WHERE name='Members'`);

    const aLogin = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const A = { cookie: cookieFrom(aLogin.headers['set-cookie']) };

    // a non-admin role that can USE the projects API (global perms), then a user with it.
    // Ensure the permission keys exist (projects module should register them; fall back to inserting them).
    for (const k of ['projects:read', 'projects:write']) await db.query(`INSERT INTO permissions(key) VALUES ($1) ON CONFLICT DO NOTHING`, [k]);
    await server.app.inject({ method: 'POST', url: '/api/admin/roles', headers: A, payload: { name: 'projuser', permissions: ['projects:read', 'projects:write'] } });
    await server.app.inject({ method: 'POST', url: '/api/admin/users', headers: A, payload: { email: 'member@example.com', password: 'pw123456', roleNames: ['projuser'] } });

    const users = (await server.app.inject({ method: 'GET', url: '/api/admin/users', headers: A })).json().users as Array<{ id: string; email: string }>;
    const memberId = users.find((u) => u.email === 'member@example.com')!.id;
    const adminId = users.find((u) => u.email === 'admin@example.com')!.id;

    const pid = (await server.app.inject({ method: 'POST', url: '/api/projects', headers: A, payload: { name: 'Members' } })).json().id; // admin = owner

    const mLogin = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'member@example.com', password: 'pw123456' } });
    const M = { cookie: cookieFrom(mLogin.headers['set-cookie']) };

    // not a member yet → invisible + 404
    expect(((await server.app.inject({ method: 'GET', url: '/api/projects', headers: M })).json().projects as Array<{ id: string }>).some((p) => p.id === pid)).toBe(false);
    expect((await server.app.inject({ method: 'GET', url: `/api/projects/${pid}`, headers: M })).statusCode).toBe(404);

    // admin adds member as viewer
    expect((await server.app.inject({ method: 'POST', url: `/api/projects/${pid}/members`, headers: A, payload: { userId: memberId, role: 'viewer' } })).statusCode).toBe(201);

    // visible w/ role viewer; can GET; cannot rename or manage members
    const listed = (await server.app.inject({ method: 'GET', url: '/api/projects', headers: M })).json().projects as Array<{ id: string; role: string }>;
    expect(listed.find((p) => p.id === pid)?.role).toBe('viewer');
    expect((await server.app.inject({ method: 'PATCH', url: `/api/projects/${pid}`, headers: M, payload: { name: 'Nope' } })).statusCode).toBe(403);
    expect((await server.app.inject({ method: 'POST', url: `/api/projects/${pid}/members`, headers: M, payload: { userId: adminId, role: 'viewer' } })).statusCode).toBe(403);

    // promote to owner → can rename now
    expect((await server.app.inject({ method: 'PATCH', url: `/api/projects/${pid}/members/${memberId}`, headers: A, payload: { role: 'owner' } })).statusCode).toBe(200);
    expect((await server.app.inject({ method: 'PATCH', url: `/api/projects/${pid}`, headers: M, payload: { name: 'Members' } })).statusCode).toBe(200);

    // last-owner guard: drop admin (2 owners → 1 OK), then removing the sole owner fails
    expect((await server.app.inject({ method: 'DELETE', url: `/api/projects/${pid}/members/${adminId}`, headers: A })).statusCode).toBe(200);
    expect((await server.app.inject({ method: 'DELETE', url: `/api/projects/${pid}/members/${memberId}`, headers: A })).statusCode).toBe(400);
  });
```

- [ ] **Step 3: Run → PASS:** `pnpm run infra:up && pnpm --filter @so/projects test` (both/all `it`s green; timeout 120000). If a `projects:read/write` permission key truly isn't registered, the `INSERT INTO permissions` fallback covers it.
- [ ] **Step 4: Commit:** `git add -A && git commit -m "feat(projects): membership access boundary — roles, owner-gating, backfill" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"`

---

## Task 3: API + `MembersTable` (+ test)

**Files:** Modify `apps/web/src/api.ts`; Create `apps/web/src/components/MembersTable.tsx` (+ `.test.tsx`)

- [ ] **Step 1: `api.ts`** — add `role` to the project shape on `listProjects`/`listArchivedProjects` and add member verbs. Update those two methods' generics to `Array<{ id: string; name: string; description?: string; role?: 'owner' | 'editor' | 'viewer' | 'admin' }>` and add:
```ts
  listMembers: (id: string) => req<{ members: Array<{ userId: string; email: string; role: 'owner' | 'editor' | 'viewer' }> }>('GET', `/projects/${id}/members`),
  listProjectCandidates: (id: string) => req<{ users: Array<{ id: string; email: string }> }>('GET', `/projects/${id}/candidates`),
  addMember: (id: string, userId: string, role: string) => req<{ ok: boolean }>('POST', `/projects/${id}/members`, { userId, role }),
  setMemberRole: (id: string, userId: string, role: string) => req<{ ok: boolean }>('PATCH', `/projects/${id}/members/${userId}`, { role }),
  removeMember: (id: string, userId: string) => req<{ ok: boolean }>('DELETE', `/projects/${id}/members/${userId}`),
```

- [ ] **Step 2: `MembersTable.tsx`** — match the table markup/classes used by `apps/web/src/components/UsersTable.tsx` (READ it for the className). Component:
```tsx
export type MemberRow = { userId: string; email: string; role: 'owner' | 'editor' | 'viewer' };
export function MembersTable({ members, canManage, onChangeRole, onRemove }: {
  members: MemberRow[]; canManage: boolean; onChangeRole: (userId: string, role: string) => void; onRemove: (userId: string) => void;
}) {
  return (
    <table className="tbl">
      <thead><tr><th>Member</th><th>Role</th>{canManage ? <th /> : null}</tr></thead>
      <tbody>
        {members.map((m) => (
          <tr key={m.userId}>
            <td>{m.email}</td>
            <td>{canManage
              ? <select aria-label={`role for ${m.email}`} value={m.role} onChange={(e) => onChangeRole(m.userId, e.target.value)}>{(['owner', 'editor', 'viewer'] as const).map((r) => <option key={r} value={r}>{r}</option>)}</select>
              : m.role}</td>
            {canManage ? <td><button className="sec" onClick={() => onRemove(m.userId)}>Remove</button></td> : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```
(Use whatever table className `UsersTable` uses instead of `tbl` if it differs.)

- [ ] **Step 3: `MembersTable.test.tsx`**
```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MembersTable } from './MembersTable';
const rows = [{ userId: 'u1', email: 'a@x.com', role: 'owner' as const }, { userId: 'u2', email: 'b@x.com', role: 'viewer' as const }];
describe('MembersTable', () => {
  it('manages members when allowed', () => {
    const onChangeRole = vi.fn(); const onRemove = vi.fn();
    render(<MembersTable members={rows} canManage onChangeRole={onChangeRole} onRemove={onRemove} />);
    expect(screen.getByText('a@x.com')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('role for b@x.com'), { target: { value: 'editor' } });
    expect(onChangeRole).toHaveBeenCalledWith('u2', 'editor');
    fireEvent.click(screen.getAllByText('Remove')[1]!);
    expect(onRemove).toHaveBeenCalledWith('u2');
  });
  it('is read-only when not allowed', () => {
    render(<MembersTable members={rows} canManage={false} onChangeRole={() => {}} onRemove={() => {}} />);
    expect(screen.queryByText('Remove')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('role for a@x.com')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run → PASS:** `pnpm --filter @so/web test` (timeout 120000).

---

## Task 4: Members in `ProjectSettings` + role gating + App + help

**Files:** Modify `apps/web/src/views/ProjectSettings.tsx`, `apps/web/src/App.tsx`, `apps/web/src/help.ts`

- [ ] **Step 1: `ProjectSettings.tsx`** — READ it. Add a `role` prop and a Members section. New signature + body (adapt to the existing imports/structure):
```tsx
import { useEffect, useState } from 'react';
import { api } from '../api';
import { MembersTable, type MemberRow } from '../components/MembersTable';
export function ProjectSettings({ project, isDefault, role, onSaved, onArchived, notify }: {
  project: { id: string; name: string; description?: string };
  isDefault: boolean;
  role?: 'owner' | 'editor' | 'viewer' | 'admin';
  onSaved: () => void;
  onArchived: () => void;
  notify: (message: string, kind?: 'ok' | 'err') => void;
}) {
  const canManage = role === 'owner' || role === 'admin';
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? '');
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [candidates, setCandidates] = useState<Array<{ id: string; email: string }>>([]);
  const [addUser, setAddUser] = useState('');
  const [addRole, setAddRole] = useState('viewer');
  async function reloadMembers() {
    try { setMembers((await api.listMembers(project.id)).members); } catch { /* ignore */ }
    if (canManage) { try { const c = (await api.listProjectCandidates(project.id)).users; setCandidates(c); setAddUser(c[0]?.id ?? ''); } catch { /* ignore */ } }
  }
  useEffect(() => { reloadMembers(); /* eslint-disable-next-line */ }, [project.id]);
  async function save() { try { await api.updateProject(project.id, { name: name.trim(), description: description.trim() }); notify('Project updated.'); onSaved(); } catch (e) { notify((e as Error).message, 'err'); } }
  async function archive() { if (!window.confirm(`Archive “${project.name}”? Its data is kept and you can restore it from the Console.`)) return; try { await api.archiveProject(project.id); notify('Project archived.'); onArchived(); } catch (e) { notify((e as Error).message, 'err'); } }
  async function changeRole(userId: string, r: string) { try { await api.setMemberRole(project.id, userId, r); notify('Role updated.'); reloadMembers(); } catch (e) { notify((e as Error).message, 'err'); } }
  async function remove(userId: string) { try { await api.removeMember(project.id, userId); notify('Member removed.'); reloadMembers(); } catch (e) { notify((e as Error).message, 'err'); } }
  async function add() { if (!addUser) return; try { await api.addMember(project.id, addUser, addRole); notify('Member added.'); reloadMembers(); } catch (e) { notify((e as Error).message, 'err'); } }
  return (
    <div className="card pad" style={{ maxWidth: 640 }}>
      <h2>Project settings</h2>
      {canManage ? (
        <>
          <label htmlFor="ps-name">Name</label>
          <input id="ps-name" aria-label="project name" value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%' }} />
          <label htmlFor="ps-desc">Description</label>
          <textarea id="ps-desc" aria-label="project description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} style={{ width: '100%' }} />
          <div style={{ marginTop: 14 }}><button onClick={save}>Save changes</button></div>
        </>
      ) : <p className="muted">You have <strong>{role ?? 'no'}</strong> access to this project. Ask an owner to make changes.</p>}

      <hr style={{ margin: '22px 0', border: 0, borderTop: '1px solid var(--line)' }} />
      <h3>Members</h3>
      <MembersTable members={members} canManage={canManage} onChangeRole={changeRole} onRemove={remove} />
      {canManage ? (
        <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
          <select aria-label="add user" value={addUser} onChange={(e) => setAddUser(e.target.value)}>{candidates.map((u) => <option key={u.id} value={u.id}>{u.email}</option>)}</select>
          <select aria-label="add role" value={addRole} onChange={(e) => setAddRole(e.target.value)}>{['viewer', 'editor', 'owner'].map((r) => <option key={r} value={r}>{r}</option>)}</select>
          <button onClick={add} disabled={!addUser}>Add member</button>
        </div>
      ) : null}

      {canManage ? (
        <>
          <hr style={{ margin: '22px 0', border: 0, borderTop: '1px solid var(--line)' }} />
          <h3 style={{ color: 'var(--bad)' }}>Danger zone</h3>
          {isDefault ? <p className="muted">The Default project can’t be archived.</p>
            : <><p className="muted">Archiving hides the project from the workspace; its data is preserved and you can restore it from the Console.</p><button className="sec" onClick={archive}>Archive project</button></>}
        </>
      ) : null}
    </div>
  );
}
```
> Note: the `eslint-disable-next-line` above is ONLY acceptable if the repo's eslint has `react-hooks/exhaustive-deps` configured. It does NOT (per prior plans). **Remove that comment line** and just use `}, [project.id]);` — the empty-dep style is fine here.

- [ ] **Step 2: `App.tsx`** — the `projects`/`archived` state arrays should carry `role`. Widen their `useState` generic to `Array<{ id: string; name: string; description?: string; role?: 'owner' | 'editor' | 'viewer' | 'admin' }>`. In the `settings` case, pass `role`:
```tsx
      case 'settings': { const cur = projects.find((p) => p.id === project); return <ProjectSettings project={cur ?? { id: project, name: projName }} isDefault={project === 'project_default'} role={cur?.role} onSaved={() => reloadProjects()} onArchived={() => { openConsole(); reloadProjects(); }} notify={notify} />; }
```

- [ ] **Step 3: `help.ts`** — update the `'project:settings'` entry's steps to mention members, e.g. add: `'Add teammates under Members and set each one as viewer, editor, or owner.'` and `'Only owners (and admins) can rename, archive, or manage members.'`

- [ ] **Step 4: Verify:** `pnpm --filter @so/web typecheck` (0); `pnpm --filter @so/web test` (all pass incl. MembersTable); `pnpm --filter @so/web build`. No unused imports; no `eslint-disable react-hooks/exhaustive-deps`.
- [ ] **Step 5: Commit:** `git add -A && git commit -m "feat(web): project Members management + role-gated settings" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"`

---

## Task 5: Full verification + merge (GATED)
- [ ] Run:
```bash
cd /Users/sumitagrawal/CODE/sumit/SoftwareOntology
pnpm run infra:up && pnpm run infra:seed
pnpm typecheck; tc=$?
pnpm lint; lint=$?
pnpm test >/tmp/p54.log 2>&1; t=$?
grep -E "Tests +[0-9]+ (passed|failed)" /tmp/p54.log | tail -1
echo "tc=$tc lint=$lint t=$t"
if [ $tc -eq 0 ] && [ $lint -eq 0 ] && [ $t -eq 0 ]; then git checkout main && git merge --ff-only phase54/project-membership && echo MERGED; else echo "NOT MERGING"; fi
```
**Watch for cross-suite breakage:** other modules' tests and the e2e suite run as `admin` (`*`), so membership never blocks them and the backfill keeps existing rows visible — they should stay green. If a non-projects suite fails, investigate before merging (do NOT merge red). Flaky env: re-run once on mass ~60000ms timeouts / `ERR_IPC_CHANNEL_CLOSED` after confirming `docker info`.

---

## Self-review
- **Access boundary** — `listProjects`/`getProject` are membership-scoped; admins (`*`) see all. ✓
- **Roles + gating** — owner-gated lifecycle + member CRUD via `roleAtLeast`; last-owner guard. ✓
- **Non-breaking** — backfill makes every current user a member (admins owner); admin-run suites/e2e unaffected. ✓
- **UI** — Members table + add/change/remove; settings read-only for non-owners; help updated. ✓
- **Tested** — HTTP membership test (visibility/gating/guard) + `MembersTable` jsdom test. ✓
- **Phase B (flagged):** wire `roleAtLeast(memberRole(...))` into the 7 scoped modules' routes so non-members can't reach resources via the `X-Project` header. Ships the helper now.
