import { describe, it, expect, afterAll } from 'vitest';
import { createServer, createConfig, type AppServer } from '@so/server';
import { createLogger } from '@so/observability';
import authModule from '../src/index.js';
import { SESSION_COOKIE } from '../src/routes.js';

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
    server = await createServer({ modules: [authModule], logger: createLogger(), config });
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
