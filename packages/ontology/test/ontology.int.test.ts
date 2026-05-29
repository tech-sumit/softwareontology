import { describe, it, expect, afterAll } from 'vitest';
import { createServer, createConfig, type AppServer } from '@so/server';
import { createLogger } from '@so/observability';
import authModule from '@so/auth';
import datasetsModule from '@so/datasets';
import ontologyModule from '../src/index.js';

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

describe('ontology: define an object type and resolve its objects', () => {
  it('uploads a dataset, models it, and resolves live objects', async () => {
    server = await createServer({ modules: [authModule, datasetsModule, ontologyModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();

    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const cookie = cookieFrom(login.headers['set-cookie']);

    const upload = await server.app.inject({
      method: 'POST', url: '/api/datasets?name=flights6&format=csv',
      headers: { cookie, 'content-type': 'text/csv' },
      payload: 'flight_no,status,seats\nFL-204,Delayed,189\nFL-118,Boarding,142\nFL-552,On time,200\n',
    });
    const datasetId = upload.json().dataset.id as string;

    const create = await server.app.inject({
      method: 'POST', url: '/api/ontology/object-types',
      headers: { cookie },
      payload: {
        apiName: 'Flight', datasetId, primaryKey: 'flightNumber',
        properties: [
          { apiName: 'flightNumber', column: 'flight_no', type: 'string' },
          { apiName: 'status', column: 'status', type: 'string' },
          { apiName: 'seats', column: 'seats', type: 'int' },
        ],
      },
    });
    expect(create.statusCode).toBe(201);

    const objs = await server.app.inject({ method: 'GET', url: '/api/ontology/object-types/Flight/objects', headers: { cookie } });
    expect(objs.statusCode).toBe(200);
    const objects = objs.json().objects as Array<{ flightNumber: string; status: string; seats: number }>;
    expect(objects).toHaveLength(3);
    const fl204 = objects.find((o) => o.flightNumber === 'FL-204');
    expect(fl204?.status).toBe('Delayed');
    expect(fl204?.seats).toBe(189);

    const list = await server.app.inject({ method: 'GET', url: '/api/ontology/object-types', headers: { cookie } });
    expect(list.json().objectTypes.some((t: { apiName: string }) => t.apiName === 'Flight')).toBe(true);
  });

  it('rejects unauthenticated resolution', async () => {
    const res = await server.app.inject({ method: 'GET', url: '/api/ontology/object-types/Flight/objects' });
    expect(res.statusCode).toBe(401);
  });
});
