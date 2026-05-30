import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { createServer as createHttp, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createServer, createConfig, type AppServer } from '@so/server';
import { createLogger } from '@so/observability';
import authModule, { SESSION_COOKIE } from '../src/index.js';

let oidc: Server; let oidcPort = 0;
beforeAll(async () => {
  oidc = createHttp((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url?.startsWith('/token')) { res.end(JSON.stringify({ access_token: 'tok-123', token_type: 'Bearer' })); return; }
    if (req.url?.startsWith('/userinfo')) { res.end(JSON.stringify({ sub: 'kc-1', email: 'oidcuser@example.com' })); return; }
    res.statusCode = 404; res.end('{}');
  });
  await new Promise<void>((r) => oidc.listen(0, r)); oidcPort = (oidc.address() as AddressInfo).port;
});
let server: AppServer;
afterAll(async () => { await server?.stop(); await new Promise<void>((r) => oidc.close(() => r())); });
function cookieFrom(s: string | string[] | undefined): string { const raw = Array.isArray(s) ? s[0]! : s!; return raw.split(';')[0]!; }

describe('OIDC SSO login', () => {
  it('logs in via OIDC callback, creating a local user with our session', async () => {
    const config = createConfig({
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so',
      S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'localhost:9000', S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
      S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin', S3_BUCKET: process.env.S3_BUCKET ?? 'so-datasets',
      ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: 'admin',
      OIDC_AUTH_URL: `http://localhost:${oidcPort}/auth`, OIDC_TOKEN_URL: `http://localhost:${oidcPort}/token`,
      OIDC_USERINFO_URL: `http://localhost:${oidcPort}/userinfo`, OIDC_CLIENT_ID: 'so', OIDC_CLIENT_SECRET: 'secret',
      OIDC_REDIRECT_URI: 'http://localhost:3000/api/auth/oidc/callback',
    });
    server = await createServer({ modules: [authModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();
    const db = server.kernel.ctx.db;
    await db.query(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email='oidcuser@example.com')`);
    await db.query(`DELETE FROM users WHERE email='oidcuser@example.com'`);

    const loginRedirect = await server.app.inject({ method: 'GET', url: '/api/auth/oidc/login' });
    expect(loginRedirect.statusCode).toBe(302);
    expect(loginRedirect.headers.location).toContain(`http://localhost:${oidcPort}/auth`);

    const cb = await server.app.inject({ method: 'GET', url: '/api/auth/oidc/callback?code=abc' });
    expect(cb.statusCode).toBe(302);
    const cookie = cookieFrom(cb.headers['set-cookie']);
    expect(cookie).toContain(`${SESSION_COOKIE}=`);

    const me = await server.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe('oidcuser@example.com');
  });
});
