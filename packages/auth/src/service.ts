import { randomBytes } from 'node:crypto';
import type { Db } from '@so/sdk';
import { verifyPassword } from './password.js';

export interface AuthUser {
  id: string;
  orgId: string;
  email: string;
  permissions: string[];
}

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function createAuthService(db: Db) {
  async function getUserPermissions(userId: string): Promise<string[]> {
    const rows = await db.query<{ permission_key: string }>(
      `SELECT DISTINCT rp.permission_key
         FROM user_roles ur
         JOIN role_permissions rp ON rp.role_id = ur.role_id
        WHERE ur.user_id = $1`,
      [userId],
    );
    return rows.map((r) => r.permission_key);
  }

  async function login(email: string, password: string): Promise<string | null> {
    const rows = await db.query<{ id: string; org_id: string; password_hash: string }>(
      `SELECT id, org_id, password_hash FROM users WHERE email = $1`,
      [email],
    );
    const user = rows[0];
    if (!user || !verifyPassword(password, user.password_hash)) return null;
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    await db.query(
      `INSERT INTO sessions(token,user_id,org_id,expires_at) VALUES ($1,$2,$3,$4)`,
      [token, user.id, user.org_id, expiresAt],
    );
    return token;
  }

  async function validateSession(token: string): Promise<AuthUser | null> {
    const rows = await db.query<{ user_id: string; org_id: string; email: string }>(
      `SELECT s.user_id, s.org_id, u.email
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token = $1 AND s.expires_at > now()`,
      [token],
    );
    const r = rows[0];
    if (!r) return null;
    return { id: r.user_id, orgId: r.org_id, email: r.email, permissions: await getUserPermissions(r.user_id) };
  }

  async function logout(token: string): Promise<void> {
    await db.query(`DELETE FROM sessions WHERE token = $1`, [token]);
  }

  return { login, validateSession, logout, getUserPermissions };
}

export function hasPermission(perms: string[], required: string): boolean {
  return perms.includes('*') || perms.includes(required);
}
