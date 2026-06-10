import { describe, it, expect, afterAll } from 'vitest';
import { createServer, createConfig, type AppServer } from '@so/server';
import { createLogger } from '@so/observability';
import authModule from '@so/auth';
import adminModule from '../src/index.js';

const config = createConfig({
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so',
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'localhost:9000',
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin',
  S3_BUCKET: process.env.S3_BUCKET ?? 'so-datasets',
  ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: 'admin',
});

let server: AppServer;
afterAll(async () => { await server?.stop(); });

function cookieFrom(setCookie: string | string[] | undefined): string {
  const raw = Array.isArray(setCookie) ? setCookie[0]! : setCookie!;
  return raw.split(';')[0]!;
}

describe('admin: user & role administration', () => {
  it('creates a role and a user that can then log in', async () => {
    server = await createServer({ modules: [authModule, adminModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();

    // isolation
    const db = server.kernel.ctx.db;
    await db.query(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email='analyst@example.com')`);
    await db.query(`DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE email='analyst@example.com')`);
    await db.query(`DELETE FROM users WHERE email='analyst@example.com'`);
    await db.query(`DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE name='viewer')`);
    await db.query(`DELETE FROM roles WHERE name='viewer'`);

    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const cookie = cookieFrom(login.headers['set-cookie']);
    const auth = { cookie };

    // permissions list includes module-contributed keys
    const perms = await server.app.inject({ method: 'GET', url: '/api/admin/permissions', headers: auth });
    expect(perms.json().permissions).toContain('admin:users');

    // create a role
    const role = await server.app.inject({ method: 'POST', url: '/api/admin/roles', headers: auth, payload: { name: 'viewer', permissions: ['ontology:read'] } });
    expect(role.statusCode).toBe(201);

    // create a user with that role
    const created = await server.app.inject({ method: 'POST', url: '/api/admin/users', headers: auth, payload: { email: 'analyst@example.com', password: 'pw123', roleNames: ['viewer'] } });
    expect(created.statusCode).toBe(201);

    // it shows up
    const list = await server.app.inject({ method: 'GET', url: '/api/admin/users', headers: auth });
    const analyst = (list.json().users as Array<{ email: string; roles: string[] }>).find((u) => u.email === 'analyst@example.com');
    expect(analyst?.roles).toContain('viewer');

    // the new user can log in (proves createUser produced a valid scrypt hash)
    const newLogin = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'analyst@example.com', password: 'pw123' } });
    expect(newLogin.statusCode).toBe(200);
  });

  it('deletes a user (but never yourself) and a role (but never an admin role)', async () => {
    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const auth = { cookie: cookieFrom(login.headers['set-cookie']) };

    // deleting yourself is refused
    const self = await server.app.inject({ method: 'DELETE', url: '/api/admin/users/user_admin', headers: auth });
    expect(self.statusCode).toBe(400);

    // delete the analyst created above -> gone from the list
    const list = await server.app.inject({ method: 'GET', url: '/api/admin/users', headers: auth });
    const analyst = (list.json().users as Array<{ id: string; email: string }>).find((u) => u.email === 'analyst@example.com');
    expect(analyst).toBeDefined();
    const del = await server.app.inject({ method: 'DELETE', url: `/api/admin/users/${analyst!.id}`, headers: auth });
    expect(del.statusCode).toBe(200);
    const after = await server.app.inject({ method: 'GET', url: '/api/admin/users', headers: auth });
    expect((after.json().users as Array<{ email: string }>).some((u) => u.email === 'analyst@example.com')).toBe(false);

    // deleting the admin role (grants '*') is refused
    const adminDel = await server.app.inject({ method: 'DELETE', url: '/api/admin/roles/role_admin', headers: auth });
    expect(adminDel.statusCode).toBe(400);
    expect(adminDel.json().error).toMatch(/admin role/);

    // delete the viewer role created above -> gone from the list
    const roles = await server.app.inject({ method: 'GET', url: '/api/admin/roles', headers: auth });
    const viewer = (roles.json().roles as Array<{ id: string; name: string }>).find((r) => r.name === 'viewer');
    expect(viewer).toBeDefined();
    const roleDel = await server.app.inject({ method: 'DELETE', url: `/api/admin/roles/${viewer!.id}`, headers: auth });
    expect(roleDel.statusCode).toBe(200);
    const rolesAfter = await server.app.inject({ method: 'GET', url: '/api/admin/roles', headers: auth });
    expect((rolesAfter.json().roles as Array<{ name: string }>).some((r) => r.name === 'viewer')).toBe(false);
  });

  it('rejects unauthenticated admin access', async () => {
    const res = await server.app.inject({ method: 'GET', url: '/api/admin/users' });
    expect(res.statusCode).toBe(401);
  });
});
