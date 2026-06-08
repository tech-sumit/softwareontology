# Project Membership — Design Spec

**Goal:** Turn projects from a pure *scoping* layer into an *access boundary*: each project has **members** with a per-project **role**, you only see/manage projects you belong to, and lifecycle (rename/archive) + member management are owner-gated. Org-admins (`*`) retain full access to everything.

## Decisions (made deliberately; reversible later)

- **Roles:** `owner` ⊃ `editor` ⊃ `viewer`.
  - **viewer** — sees the project and reads its resources.
  - **editor** — + creates/modifies resources inside the project *(enforced in Phase B)*.
  - **owner** — + rename/describe, archive/restore, and manage members.
  - **org-admin** (`permissions.includes('*')`) — full access to all projects; surfaced to the client as role `admin`.
- **Non-breaking backfill:** on migration, every existing `(project × user-in-org)` becomes an `editor`; every `*`-admin is upgraded to `owner` (guarantees ≥1 owner per project and preserves "admins see everything"). Result: current behaviour is unchanged for existing users.
- **New projects:** the creator becomes `owner`.
- **New users:** start with **no** memberships (an owner/admin adds them) — that's the boundary working as intended. Admins always see all.
- **Last-owner guard:** removing or downgrading the final `owner` of a project is rejected (400).

## Scope

**Phase A (this spec):** the access boundary at the *project* level — membership model, role-aware `listProjects`/`getProject`, owner-gated lifecycle + member CRUD, and a **Members** management UI in Project Settings. The `projects` module returns the caller's `role` per project so the UI can gate controls.

**Phase B (deferred, flagged):** wire a `requireProjectMember(minRole)` check into every scoped module's routes (datasets, pipelines, connectors-×3, apps, automations) so a non-member can't reach resources by setting the `X-Project` header directly. Phase A ships the reusable helper; Phase B applies it across modules + updates their tests.

## Data model (`@so/projects`)

```sql
CREATE TABLE IF NOT EXISTS project_members (
  project_id text NOT NULL,
  user_id    text NOT NULL,
  role       text NOT NULL,           -- 'owner' | 'editor' | 'viewer'
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
)
-- backfill (idempotent):
INSERT INTO project_members(project_id,user_id,role)
  SELECT p.id, u.id, 'editor' FROM projects p JOIN users u ON u.org_id = p.org_id
  ON CONFLICT DO NOTHING;
UPDATE project_members SET role='owner'
  WHERE user_id IN (SELECT ur.user_id FROM user_roles ur
                    JOIN role_permissions rp ON rp.role_id = ur.role_id
                    WHERE rp.permission_key = '*');
```
(Safe because `auth` migrates before `projects` in dependency order, so `users`/`user_roles`/`role_permissions` exist.)

## API surface

- `GET /projects` / `GET /projects/archived` → only the caller's projects (admin: all); each project carries `role`.
- `GET /projects/:id` → member-or-admin else 404.
- `PATCH /projects/:id`, `POST /:id/archive`, `POST /:id/restore` → owner-or-admin.
- `GET /projects/:id/members` → member-or-admin; returns `[{userId,email,role}]`.
- `POST /:id/members {userId,role}` · `PATCH /:id/members/:userId {role}` · `DELETE /:id/members/:userId` → owner-or-admin; last-owner guard.

## UI

Project **Settings** gains a **Members** section (a tested `MembersTable`): list members with a role selector + remove, and an "add member" row that picks a user from `admin.listUsers`. The section + the rename/archive controls render only when the caller's `role` is `owner` or `admin`; viewers/editors see a read-only member list and no danger zone.

## Testing

`@so/projects` integration test: backfill visibility (admin sees all), add a second user as `viewer` → they can `GET` it but not `PATCH`/archive (403) and not manage members; promote to `owner`; last-owner removal rejected; a non-member gets 404 on `GET /:id`. A `MembersTable` jsdom test.
