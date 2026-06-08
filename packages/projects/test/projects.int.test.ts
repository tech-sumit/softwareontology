import { describe, it, expect, afterAll } from 'vitest';
import { createServer, createConfig, type AppServer } from '@so/server';
import { createLogger } from '@so/observability';
import authModule from '@so/auth';
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
    server = await createServer({ modules: [authModule, projectsModule], logger: createLogger(), config });
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
});
