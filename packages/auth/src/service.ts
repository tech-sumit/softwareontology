import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '@so/sdk';
import { verifyPassword } from './password.js';

export interface AuthUser {
  id: string;
  orgId: string;
  email: string;
  permissions: string[];
}

export interface ApiTokenSummary {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
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

  function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  /** Mint a personal API token. Only its sha256 hash is stored; the plaintext is returned ONCE. */
  async function createApiToken(orgId: string, userId: string, name: string): Promise<{ id: string; token: string }> {
    const token = `so_${randomBytes(32).toString('hex')}`;
    const id = `tok_${randomBytes(8).toString('hex')}`;
    await db.query(
      `INSERT INTO api_tokens(id, org_id, user_id, name, token_hash) VALUES ($1,$2,$3,$4,$5)`,
      [id, orgId, userId, name, sha256(token)],
    );
    return { id, token };
  }

  async function listApiTokens(orgId: string, userId: string): Promise<ApiTokenSummary[]> {
    const rows = await db.query<{ id: string; name: string; created_at: string | Date; last_used_at: string | Date | null }>(
      `SELECT id, name, created_at, last_used_at FROM api_tokens WHERE org_id = $1 AND user_id = $2 ORDER BY created_at DESC`,
      [orgId, userId],
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      createdAt: new Date(r.created_at).toISOString(),
      lastUsedAt: r.last_used_at === null ? null : new Date(r.last_used_at).toISOString(),
    }));
  }

  async function deleteApiToken(orgId: string, userId: string, id: string): Promise<void> {
    await db.query(`DELETE FROM api_tokens WHERE org_id = $1 AND user_id = $2 AND id = $3`, [orgId, userId, id]);
  }

  /** Resolve a bearer token (`so_…`) to the same AuthUser shape validateSession returns. */
  async function validateApiToken(token: string): Promise<AuthUser | null> {
    if (!token.startsWith('so_')) return null;
    const rows = await db.query<{ id: string; user_id: string; org_id: string; email: string }>(
      `SELECT t.id, t.user_id, t.org_id, u.email
         FROM api_tokens t JOIN users u ON u.id = t.user_id
        WHERE t.token_hash = $1`,
      [sha256(token)],
    );
    const r = rows[0];
    if (!r) return null;
    // fire-and-forget: a usage-timestamp failure must never fail the request
    void db.query(`UPDATE api_tokens SET last_used_at = now() WHERE id = $1`, [r.id]).catch(() => {});
    return { id: r.user_id, orgId: r.org_id, email: r.email, permissions: await getUserPermissions(r.user_id) };
  }

  return { login, validateSession, logout, getUserPermissions, createApiToken, listApiTokens, deleteApiToken, validateApiToken };
}

export function hasPermission(perms: string[], required: string): boolean {
  return perms.includes('*') || perms.includes(required);
}
