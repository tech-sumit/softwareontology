import { randomBytes, randomUUID } from 'node:crypto';
import type { Db, Config } from '@so/sdk';
import { hashPassword } from './password.js';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function createOidcService(db: Db, config: Config) {
  function authUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: config.require('OIDC_CLIENT_ID'),
      redirect_uri: config.require('OIDC_REDIRECT_URI'),
      response_type: 'code', scope: 'openid email', state,
    });
    return `${config.require('OIDC_AUTH_URL')}?${params.toString()}`;
  }

  async function handleCallback(code: string): Promise<string> {
    const tokenRes = await fetch(config.require('OIDC_TOKEN_URL'), {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: config.require('OIDC_REDIRECT_URI'), client_id: config.require('OIDC_CLIENT_ID'), client_secret: config.get('OIDC_CLIENT_SECRET') ?? '' }).toString(),
    });
    if (!tokenRes.ok) throw new Error('oidc token exchange failed');
    const tok = (await tokenRes.json()) as { access_token?: string };
    if (!tok.access_token) throw new Error('no access_token from oidc');

    const uiRes = await fetch(config.require('OIDC_USERINFO_URL'), { headers: { authorization: `Bearer ${tok.access_token}` } });
    if (!uiRes.ok) throw new Error('oidc userinfo failed');
    const ui = (await uiRes.json()) as { sub?: string; email?: string };
    if (!ui.email) throw new Error('no email from oidc');

    const existing = await db.query<{ id: string; org_id: string }>(`SELECT id, org_id FROM users WHERE email = $1`, [ui.email]);
    let userId: string; let orgId = 'org_default';
    if (existing[0]) { userId = existing[0].id; orgId = existing[0].org_id; }
    else { userId = randomUUID(); await db.query(`INSERT INTO users(id,org_id,email,password_hash) VALUES ($1,$2,$3,$4)`, [userId, orgId, ui.email, hashPassword(randomBytes(24).toString('hex'))]); }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    await db.query(`INSERT INTO sessions(token,user_id,org_id,expires_at) VALUES ($1,$2,$3,$4)`, [token, userId, orgId, expiresAt]);
    return token;
  }

  return { authUrl, handleCallback };
}
