import { describe, it, expect, afterAll } from 'vitest';
import { createServer, createConfig, type AppServer } from '@so/server';
import { createLogger } from '@so/observability';
import { defineModule } from '@so/sdk';
import type { FastifyPluginAsync } from 'fastify';
import authModule from '../src/index.js';
import { SESSION_COOKIE } from '../src/routes.js';
import { requirePermission } from '../src/guard.js';

/** A tiny module with a permission-guarded route, to exercise the bearer path through requirePermission. */
const guardedRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/ping', { preHandler: requirePermission('auth:read') }, async (req) => ({ user: req.user }));
};
const guardedModule = defineModule({
  id: 'guardedtest',
  dependsOn: ['auth'],
  contributes: { apiRoutes: guardedRoutes },
});

const config = createConfig({
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so',
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'localhost:9000',
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin',
  S3_BUCKET: process.env.S3_BUCKET ?? 'so-datasets',
  ADMIN_EMAIL: 'admin@example.com',
  ADMIN_PASSWORD: 'admin',
});

let server: AppServer;
afterAll(async () => { await server?.stop(); });

function cookieFrom(setCookie: string | string[] | undefined): string {
  const raw = Array.isArray(setCookie) ? setCookie[0]! : setCookie!;
  return raw.split(';')[0]!; // "so_session=<token>"
}

describe('auth routes', () => {
  it('logs in, returns the current user, then logs out', async () => {
    server = await createServer({ modules: [authModule, guardedModule], logger: createLogger(), config });
    await server.kernel.start(); // runs migrations + seed
    await server.app.ready();

    const login = await server.app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { email: 'admin@example.com', password: 'admin' },
    });
    expect(login.statusCode).toBe(200);
    const cookie = cookieFrom(login.headers['set-cookie']);
    expect(cookie).toContain(`${SESSION_COOKIE}=`);

    const me = await server.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe('admin@example.com');
    expect(me.json().user.permissions).toContain('*');

    const logout = await server.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
    expect(logout.statusCode).toBe(200);
  });

  it('rejects bad credentials and missing sessions', async () => {
    const bad = await server.app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { email: 'admin@example.com', password: 'nope' },
    });
    expect(bad.statusCode).toBe(401);

    const anon = await server.app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(anon.statusCode).toBe(401);
  });
});

describe('personal API tokens', () => {
  it('mints a token usable as Bearer auth (no cookie), then revokes it', async () => {
    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const cookie = cookieFrom(login.headers['set-cookie']);

    const noName = await server.app.inject({ method: 'POST', url: '/api/auth/tokens', headers: { cookie }, payload: {} });
    expect(noName.statusCode).toBe(400);

    const created = await server.app.inject({ method: 'POST', url: '/api/auth/tokens', headers: { cookie }, payload: { name: 'ci-token' } });
    expect(created.statusCode).toBe(201);
    const { id, token } = created.json() as { id: string; token: string };
    expect(token.startsWith('so_')).toBe(true);

    // bearer auth, NO cookie — both the /me route and a requirePermission-guarded route
    const me = await server.app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${token}` } });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe('admin@example.com');

    const guarded = await server.app.inject({ method: 'GET', url: '/api/guardedtest/ping', headers: { authorization: `Bearer ${token}` } });
    expect(guarded.statusCode).toBe(200);
    expect(guarded.json().user).toMatchObject({ id: 'user_admin', orgId: 'org_default', email: 'admin@example.com' });
    expect(guarded.json().user.permissions).toContain('*');

    // bad token → 401
    const bad = await server.app.inject({ method: 'GET', url: '/api/guardedtest/ping', headers: { authorization: 'Bearer so_definitely_not_a_real_token' } });
    expect(bad.statusCode).toBe(401);

    // list shows metadata only — never the token or its hash
    const list = await server.app.inject({ method: 'GET', url: '/api/auth/tokens', headers: { cookie } });
    expect(list.statusCode).toBe(200);
    const mine = (list.json().tokens as Array<{ id: string; name: string; createdAt: string }>).find((t) => t.id === id);
    expect(mine?.name).toBe('ci-token');
    expect(JSON.stringify(list.json())).not.toContain(token);

    // revoke → the token stops working
    const del = await server.app.inject({ method: 'DELETE', url: `/api/auth/tokens/${id}`, headers: { cookie } });
    expect(del.statusCode).toBe(200);
    const after = await server.app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${token}` } });
    expect(after.statusCode).toBe(401);
  });

  it('requires authentication for token management', async () => {
    const anon = await server.app.inject({ method: 'GET', url: '/api/auth/tokens' });
    expect(anon.statusCode).toBe(401);
    const anonCreate = await server.app.inject({ method: 'POST', url: '/api/auth/tokens', payload: { name: 'x' } });
    expect(anonCreate.statusCode).toBe(401);
  });
});
