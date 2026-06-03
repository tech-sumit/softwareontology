# Phase 49 — Admin: Roles & Permissions Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps `- [ ]`.

**Goal:** Complete the Admin surface: list/create **roles** (with a permission multi-select from the real permission registry), create **users with roles**, and show each user's/role's grants. Backend exists (`GET /admin/roles|permissions`, `POST /admin/roles|users`).

**Architecture:** `api.ts` (`createRole`, `listPermissions`, extend `createUser` with `roleNames`); a pure `RolesTable` (jsdom-tested); enhance `AdminView` (Users + Roles sections).

---

## Pre-flight
- [ ] **Branch:** `git checkout main && git checkout -b phase49/admin-roles`

---

## Task 1: API + `RolesTable` (+ test)

**Files:** Modify `apps/web/src/api.ts`; Create `apps/web/src/components/RolesTable.tsx` (+ `.test.tsx`)

- [ ] **Step 1: `api.ts`** — add/extend (READ existing `createUser`/`listUsers`/`listRoles` first; `listRoles` returns `{ roles: [{id,name,permissions?}] }` — ensure it carries `permissions`; the admin service `RoleSummary` has `permissions`, so widen the `listRoles` type to include `permissions: string[]`):
```ts
  listPermissions: () => req<{ permissions: string[] }>('GET', '/admin/permissions'),
  createRole: (name: string, permissions: string[]) => req<{ ok: boolean }>('POST', '/admin/roles', { name, permissions }),
  createUser: (email: string, password: string, roleNames: string[] = []) => req<{ user: unknown }>('POST', '/admin/users', { email, password, roleNames }),
```
(Replace the existing `createUser` definition — don't duplicate. Widen `listRoles` return type to `Array<{ id: string; name: string; permissions: string[] }>`.)

- [ ] **Step 2: `components/RolesTable.tsx`**
```tsx
export function RolesTable({ roles }: { roles: Array<{ id: string; name: string; permissions: string[] }> }) {
  if (roles.length === 0) return <p style={{ color: 'var(--muted)' }}>No roles.</p>;
  return (
    <table>
      <thead><tr><th>Role</th><th>Permissions</th></tr></thead>
      <tbody>
        {roles.map((r) => (
          <tr key={r.id}><td><b>{r.name}</b></td><td>{r.permissions.length === 0 ? <span className="muted">none</span> : r.permissions.map((p) => <span key={p} className="badge run" style={{ marginRight: 5 }}>{p}</span>)}</td></tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 3: `components/RolesTable.test.tsx`**
```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { RolesTable } from './RolesTable';
describe('RolesTable', () => {
  it('renders roles + permission badges', () => {
    render(<RolesTable roles={[{ id: '1', name: 'admin', permissions: ['*'] }, { id: '2', name: 'viewer', permissions: ['datasets:read', 'ontology:read'] }]} />);
    expect(screen.getByText('admin')).toBeInTheDocument();
    expect(screen.getByText('viewer')).toBeInTheDocument();
    expect(screen.getByText('datasets:read')).toBeInTheDocument();
  });
  it('empty state', () => { render(<RolesTable roles={[]} />); expect(screen.getByText(/no roles/i)).toBeInTheDocument(); });
});
```

- [ ] **Step 4: Run → PASS:** `pnpm --filter @so/web test -- RolesTable` (timeout 120000).

---

## Task 2: Enhance `AdminView` + verify

**Files:** Modify `apps/web/src/views/AdminView.tsx`

- [ ] **Step 1:** READ `AdminView.tsx`, then extend it (keep the existing `UsersTable`):
  - On mount load `listUsers`, `listRoles`, `listPermissions`.
  - **Users** section: existing `UsersTable` + a create-user form: email, password, and a roles multi-select (checkboxes of role names from `listRoles`) → `createUser(email, password, selectedRoleNames)` → reload.
  - **Roles** section: `<RolesTable roles={roles} />` + a create-role form: name + a permissions multi-select (checkboxes of `listPermissions()`) → `createRole(name, selectedPerms)` → reload.
  - `card`/`err`/`muted` classes; green msg on success; surface errors inline.

- [ ] **Step 2: Verify:** `pnpm --filter @so/web typecheck` (0); `pnpm --filter @so/web test` (all pass incl. RolesTable); `pnpm --filter @so/web build`. No unused imports; no `eslint-disable react-hooks/exhaustive-deps`.

- [ ] **Step 3: Commit:** `git add -A && git commit -m "feat(web): Admin — roles + permissions + create user with roles"`

---

## Task 3: Full verification + merge (GATED)
- [ ] `pnpm run infra:up && pnpm run infra:seed && pnpm typecheck; pnpm lint`; then `pnpm test >/tmp/v.log 2>&1; t=$?; grep -E "Tests +[0-9]+ (passed|failed)" /tmp/v.log | tail -1`. **Only if tc/lint/`t` all 0**: `git checkout main && git merge --ff-only phase49/admin-roles`. (Flaky env: re-run on mass timeouts / `ERR_IPC_CHANNEL_CLOSED`; ensure Docker up.)

---

## Self-review
- **Admin complete** — roles (list w/ permissions, create with a permission picker), users created with roles, all viewable. Closes the admin gap. ✓
- **Testable** — pure `RolesTable` jsdom-tested. ✓
- **Deferred → Plan 50:** editing/removing a user's roles or a role's permissions after creation (needs new endpoints); per-user clearance view. Flagged.
