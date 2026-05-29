import { describe, it, expect, afterAll } from 'vitest';
import { createServer, createConfig, type AppServer } from '@so/server';
import { createLogger } from '@so/observability';
import authModule from '@so/auth';
import datasetsModule from '../src/index.js';
import { SESSION_COOKIE } from '@so/auth';

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
  return raw.split(';')[0]!;
}

describe('dataset routes', () => {
  it('rejects unauthenticated access', async () => {
    server = await createServer({ modules: [authModule, datasetsModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();
    const res = await server.app.inject({ method: 'GET', url: '/api/datasets' });
    expect(res.statusCode).toBe(401);
  });

  it('uploads a CSV, lists it, and previews rows', async () => {
    const login = await server.app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { email: 'admin@example.com', password: 'admin' },
    });
    const cookie = cookieFrom(login.headers['set-cookie']);

    const upload = await server.app.inject({
      method: 'POST', url: '/api/datasets?name=flights&format=csv',
      headers: { cookie, 'content-type': 'text/csv' },
      payload: 'flight_no,status\nFL-204,Delayed\nFL-118,Boarding\nFL-552,On time\n',
    });
    expect(upload.statusCode).toBe(201);
    const dsId = upload.json().dataset.id as string;
    expect(upload.json().dataset.rowCount).toBe(3);
    expect(upload.json().dataset.columns.map((c: { name: string }) => c.name)).toEqual(['flight_no', 'status']);

    const list = await server.app.inject({ method: 'GET', url: '/api/datasets', headers: { cookie } });
    expect(list.statusCode).toBe(200);
    expect(list.json().datasets.some((d: { id: string }) => d.id === dsId)).toBe(true);

    const preview = await server.app.inject({ method: 'GET', url: `/api/datasets/${dsId}/preview`, headers: { cookie } });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().rows).toHaveLength(3);
    expect(preview.json().rows[0].flight_no).toBe('FL-204');
  });
});
