import { describe, it, expect, afterAll } from 'vitest';
import { createServer, createConfig, type AppServer } from '@so/server';
import { createLogger } from '@so/observability';
import authModule from '@so/auth';
import adminModule from '@so/admin';
import projectsModule from '../src/index.js';

const config = createConfig({
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so',
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'localhost:9000', S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin', S3_BUCKET: process.env.S3_BUCKET ?? 'so-datasets',
  ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: 'admin',
});
let server: AppServer;
afterAll(async () => { await server?.stop(); });
function cookieFrom(s: string | string[] | undefined): string { const raw = Array.isArray(s) ? s[0]! : s!; return raw.split(';')[0]!; }

describe('projects: CRUD + Default bootstrap', () => {
  it('bootstraps Default and creates/lists/gets projects', async () => {
    server = await createServer({ modules: [authModule, projectsModule, adminModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();
    await server.kernel.ctx.db.query(`DELETE FROM projects WHERE name='Marketing'`);

    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const a = { cookie: cookieFrom(login.headers['set-cookie']) };

    // Default exists from bootstrap, listed first
    const list0 = await server.app.inject({ method: 'GET', url: '/api/projects', headers: a });
    const names0 = (list0.json().projects as Array<{ id: string; name: string }>);
    expect(names0.some((p) => p.id === 'project_default' && p.name === 'Default')).toBe(true);
    expect(names0[0]!.id).toBe('project_default'); // Default sorted first

    const create = await server.app.inject({ method: 'POST', url: '/api/projects', headers: a, payload: { name: 'Marketing' } });
    expect(create.statusCode).toBe(201);
    const id = create.json().id;

    const got = await server.app.inject({ method: 'GET', url: `/api/projects/${id}`, headers: a });
    expect(got.json().name).toBe('Marketing');

    const list = await server.app.inject({ method: 'GET', url: '/api/projects', headers: a });
    expect((list.json().projects as Array<{ name: string }>).some((p) => p.name === 'Marketing')).toBe(true);

    // idempotent create returns the same id
    const again = await server.app.inject({ method: 'POST', url: '/api/projects', headers: a, payload: { name: 'Marketing' } });
    expect(again.json().id).toBe(id);
  });

  it('renames, archives (hiding from list), and restores — but never the Default', async () => {
    await server.kernel.ctx.db.query(`DELETE FROM projects WHERE name IN ('Lifecycle','Lifecycle2')`);
    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const a = { cookie: cookieFrom(login.headers['set-cookie']) };

    const id = (await server.app.inject({ method: 'POST', url: '/api/projects', headers: a, payload: { name: 'Lifecycle' } })).json().id;

    // rename + describe
    const patched = await server.app.inject({ method: 'PATCH', url: `/api/projects/${id}`, headers: a, payload: { name: 'Lifecycle2', description: 'desc' } });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().name).toBe('Lifecycle2');
    expect(patched.json().description).toBe('desc');

    // archive → gone from list, present in archived
    expect((await server.app.inject({ method: 'POST', url: `/api/projects/${id}/archive`, headers: a })).statusCode).toBe(200);
    const listed = (await server.app.inject({ method: 'GET', url: '/api/projects', headers: a })).json().projects as Array<{ id: string }>;
    expect(listed.some((p) => p.id === id)).toBe(false);
    const archived = (await server.app.inject({ method: 'GET', url: '/api/projects/archived', headers: a })).json().projects as Array<{ id: string }>;
    expect(archived.some((p) => p.id === id)).toBe(true);

    // restore → back in list
    expect((await server.app.inject({ method: 'POST', url: `/api/projects/${id}/restore`, headers: a })).statusCode).toBe(200);
    const relisted = (await server.app.inject({ method: 'GET', url: '/api/projects', headers: a })).json().projects as Array<{ id: string }>;
    expect(relisted.some((p) => p.id === id)).toBe(true);

    // Default cannot be archived
    expect((await server.app.inject({ method: 'POST', url: '/api/projects/project_default/archive', headers: a })).statusCode).toBe(400);
  });

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
});
