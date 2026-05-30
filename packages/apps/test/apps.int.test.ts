import { describe, it, expect, afterAll } from 'vitest';
import { createServer, createConfig, type AppServer } from '@so/server';
import { createLogger } from '@so/observability';
import authModule from '@so/auth';
import appsModule from '../src/index.js';

const config = createConfig({
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so',
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'localhost:9000', S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin', S3_BUCKET: process.env.S3_BUCKET ?? 'so-datasets',
  ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: 'admin',
});
let server: AppServer;
afterAll(async () => { await server?.stop(); });
function cookieFrom(s: string | string[] | undefined): string { const raw = Array.isArray(s) ? s[0]! : s!; return raw.split(';')[0]!; }

describe('apps: app-definition CRUD + validation', () => {
  it('creates, reads, updates, validates, and deletes an app', async () => {
    server = await createServer({ modules: [authModule, appsModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();
    await server.kernel.ctx.db.query(`DELETE FROM apps WHERE name IN ('Ops Console','Ops Console v2')`);

    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const a = { cookie: cookieFrom(login.headers['set-cookie']) };

    const definition = { widgets: [
      { id: 'w1', type: 'object-table', title: 'Flights', config: { objectType: 'Flight' } },
      { id: 'w2', type: 'metric', title: 'Total', config: { objectType: 'Flight' } },
      { id: 'w3', type: 'action-button', title: 'Cancel', config: { action: 'cancelFlight' } },
    ] };
    const create = await server.app.inject({ method: 'POST', url: '/api/apps', headers: a, payload: { name: 'Ops Console', definition } });
    expect(create.statusCode).toBe(201);
    const id = create.json().id;

    const list = await server.app.inject({ method: 'GET', url: '/api/apps', headers: a });
    expect((list.json().apps as Array<{ name: string }>).some((x) => x.name === 'Ops Console')).toBe(true);

    const got = await server.app.inject({ method: 'GET', url: `/api/apps/${id}`, headers: a });
    expect(got.json().definition.widgets).toHaveLength(3);
    expect(got.json().definition.widgets[0].config.objectType).toBe('Flight');

    const upd = await server.app.inject({ method: 'PUT', url: `/api/apps/${id}`, headers: a, payload: { name: 'Ops Console v2' } });
    expect(upd.statusCode).toBe(200);
    const got2 = await server.app.inject({ method: 'GET', url: `/api/apps/${id}`, headers: a });
    expect(got2.json().name).toBe('Ops Console v2');
    expect(got2.json().definition.widgets).toHaveLength(3); // definition preserved on name-only update

    const bad = await server.app.inject({ method: 'POST', url: '/api/apps', headers: a, payload: { name: 'Bad', definition: { widgets: [{ id: 'x', type: 'frobnicate', config: {} }] } } });
    expect(bad.statusCode).toBe(400);

    const del = await server.app.inject({ method: 'DELETE', url: `/api/apps/${id}`, headers: a });
    expect(del.statusCode).toBe(200);
    const gone = await server.app.inject({ method: 'GET', url: `/api/apps/${id}`, headers: a });
    expect(gone.statusCode).toBe(404);
  });
});
