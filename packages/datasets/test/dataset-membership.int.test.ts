import { describe, it, expect, afterAll } from 'vitest';
import { createServer, createConfig, type AppServer } from '@so/server';
import { createLogger } from '@so/observability';
import authModule from '@so/auth';
import adminModule from '@so/admin';
import projectsModule from '@so/projects';
import datasetsModule from '../src/index.js';

const config = createConfig({
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so',
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'localhost:9000', S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin', S3_BUCKET: process.env.S3_BUCKET ?? 'so-datasets',
  ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: 'admin',
});
let server: AppServer;
afterAll(async () => { await server?.stop(); });
function cookieFrom(s: string | string[] | undefined): string { const raw = Array.isArray(s) ? s[0]! : s!; return raw.split(';')[0]!; }

describe('datasets: project-membership enforcement (C1)', () => {
  it('blocks a non-member non-admin from reading another project; admin (wildcard) still can', async () => {
    server = await createServer({ modules: [authModule, projectsModule, adminModule, datasetsModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();
    const db = server.kernel.ctx.db;

    // clean slate
    await db.query(`DELETE FROM project_members WHERE user_id IN (SELECT id FROM users WHERE email='dsmember@example.com')`);
    await db.query(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email='dsmember@example.com')`);
    await db.query(`DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE email='dsmember@example.com')`);
    await db.query(`DELETE FROM users WHERE email='dsmember@example.com'`);
    await db.query(`DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE name='dsreader')`);
    await db.query(`DELETE FROM roles WHERE name='dsreader'`);
    await db.query(`DELETE FROM project_members WHERE project_id IN (SELECT id FROM projects WHERE name IN ('IsoOther','IsoMine'))`);
    await db.query(`DELETE FROM projects WHERE name IN ('IsoOther','IsoMine')`);

    const aLogin = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const adminCookie = cookieFrom(aLogin.headers['set-cookie']);

    // non-admin role with the relevant permissions; ensure permission keys exist
    for (const k of ['datasets:read', 'projects:read']) await db.query(`INSERT INTO permissions(key) VALUES ($1) ON CONFLICT DO NOTHING`, [k]);
    await server.app.inject({ method: 'POST', url: '/api/admin/roles', headers: { cookie: adminCookie }, payload: { name: 'dsreader', permissions: ['datasets:read', 'projects:read'] } });
    await server.app.inject({ method: 'POST', url: '/api/admin/users', headers: { cookie: adminCookie }, payload: { email: 'dsmember@example.com', password: 'pw123456', roleNames: ['dsreader'] } });

    const users = (await server.app.inject({ method: 'GET', url: '/api/admin/users', headers: { cookie: adminCookie } })).json().users as Array<{ id: string; email: string }>;
    const memberId = users.find((u) => u.email === 'dsmember@example.com')!.id;

    // admin creates two projects; member is added to one only
    const otherId = (await server.app.inject({ method: 'POST', url: '/api/projects', headers: { cookie: adminCookie }, payload: { name: 'IsoOther' } })).json().id;
    const mineId = (await server.app.inject({ method: 'POST', url: '/api/projects', headers: { cookie: adminCookie }, payload: { name: 'IsoMine' } })).json().id;
    expect((await server.app.inject({ method: 'POST', url: `/api/projects/${mineId}/members`, headers: { cookie: adminCookie }, payload: { userId: memberId, role: 'viewer' } })).statusCode).toBe(201);

    const mLogin = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'dsmember@example.com', password: 'pw123456' } });
    const userCookie = cookieFrom(mLogin.headers['set-cookie']);

    // member-less user cannot read a project they are NOT a member of
    const r = await server.app.inject({ method: 'GET', url: '/api/datasets', headers: { cookie: userCookie, 'x-project': otherId } });
    expect(r.statusCode).toBe(403);

    // but CAN read the project they ARE a member of
    const rok = await server.app.inject({ method: 'GET', url: '/api/datasets', headers: { cookie: userCookie, 'x-project': mineId } });
    expect(rok.statusCode).toBe(200);

    // admin (wildcard) bypasses membership and still can read the other project
    const ra = await server.app.inject({ method: 'GET', url: '/api/datasets', headers: { cookie: adminCookie, 'x-project': otherId } });
    expect(ra.statusCode).toBe(200);
  });
});
