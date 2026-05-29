import { randomUUID } from 'node:crypto';
import type { ModuleContext } from '@so/sdk';
import { hashPassword } from '@so/auth';

export interface UserSummary { id: string; email: string; roles: string[]; }
export interface RoleSummary { name: string; permissions: string[]; }

export function createAdminService(ctx: ModuleContext) {
  async function listUsers(orgId: string): Promise<UserSummary[]> {
    const users = await ctx.db.query<{ id: string; email: string }>(
      `SELECT id, email FROM users WHERE org_id = $1 ORDER BY email`, [orgId],
    );
    const out: UserSummary[] = [];
    for (const u of users) {
      const roles = await ctx.db.query<{ name: string }>(
        `SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1 ORDER BY r.name`,
        [u.id],
      );
      out.push({ id: u.id, email: u.email, roles: roles.map((r) => r.name) });
    }
    return out;
  }

  async function createUser(orgId: string, input: { email: string; password: string; roleNames?: string[] }): Promise<UserSummary> {
    if (!input.email || !input.password) throw new Error('email and password required');
    const id = randomUUID();
    return ctx.db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO users(id,org_id,email,password_hash) VALUES ($1,$2,$3,$4)`,
        [id, orgId, input.email, hashPassword(input.password)],
      );
      for (const rn of input.roleNames ?? []) {
        const r = await tx.query<{ id: string }>(`SELECT id FROM roles WHERE org_id = $1 AND name = $2`, [orgId, rn]);
        if (!r[0]) throw new Error(`role not found: ${rn}`);
        await tx.query(`INSERT INTO user_roles(user_id,role_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, r[0].id]);
      }
      return { id, email: input.email, roles: input.roleNames ?? [] };
    });
  }

  async function listRoles(orgId: string): Promise<RoleSummary[]> {
    const roles = await ctx.db.query<{ id: string; name: string }>(`SELECT id, name FROM roles WHERE org_id = $1 ORDER BY name`, [orgId]);
    const out: RoleSummary[] = [];
    for (const r of roles) {
      const perms = await ctx.db.query<{ permission_key: string }>(`SELECT permission_key FROM role_permissions WHERE role_id = $1`, [r.id]);
      out.push({ name: r.name, permissions: perms.map((p) => p.permission_key) });
    }
    return out;
  }

  async function createRole(orgId: string, input: { name: string; permissions: string[] }): Promise<void> {
    const id = randomUUID();
    await ctx.db.transaction(async (tx) => {
      await tx.query(`INSERT INTO roles(id,org_id,name) VALUES ($1,$2,$3)`, [id, orgId, input.name]);
      for (const key of input.permissions) {
        await tx.query(`INSERT INTO permissions(key) VALUES ($1) ON CONFLICT DO NOTHING`, [key]);
        await tx.query(`INSERT INTO role_permissions(role_id,permission_key) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, key]);
      }
    });
  }

  /** All permission keys contributed by loaded modules (plus the wildcard). */
  function listPermissions(): string[] {
    const keys = ctx.registry.get<string>('permissions');
    return Array.from(new Set(['*', ...keys])).sort();
  }

  return { listUsers, createUser, listRoles, createRole, listPermissions };
}
