import { describe, it, expect, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createServer, createConfig, type AppServer } from '@so/server';
import { createLogger } from '@so/observability';
import authModule, { hashPassword } from '@so/auth';
import datasetsModule from '@so/datasets';
import ontologyModule from '../src/index.js';

const config = createConfig({
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so',
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'localhost:9000', S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin', S3_BUCKET: process.env.S3_BUCKET ?? 'so-datasets',
  ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: 'admin',
});
const OT = 'EmployeeRls';
let server: AppServer;
afterAll(async () => { await server?.stop(); });
function cookieFrom(s: string | string[] | undefined): string { const raw = Array.isArray(s) ? s[0]! : s!; return raw.split(';')[0]!; }

describe('property-level RLS: secured property is masked for users without the permission', () => {
  it('admin sees salary; a limited user does not', async () => {
    server = await createServer({ modules: [authModule, datasetsModule, ontologyModule], logger: createLogger(), config });
    await server.kernel.start();
    await server.app.ready();
    const db = server.kernel.ctx.db;
    // isolation
    await db.query(`DELETE FROM object_properties WHERE object_type_id IN (SELECT id FROM object_types WHERE org_id='org_default' AND api_name=$1)`, [OT]);
    await db.query(`DELETE FROM object_types WHERE org_id='org_default' AND api_name=$1`, [OT]);
    await db.query(`DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE email='limited@example.com')`);
    await db.query(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email='limited@example.com')`);
    await db.query(`DELETE FROM users WHERE email='limited@example.com'`);
    await db.query(`DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE name='limitedrole')`);
    await db.query(`DELETE FROM roles WHERE name='limitedrole'`);

    const adminLogin = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'admin' } });
    const admin = { cookie: cookieFrom(adminLogin.headers['set-cookie']) };

    const up = await server.app.inject({ method: 'POST', url: '/api/datasets?name=rlsds&format=csv', headers: { ...admin, 'content-type': 'text/csv' }, payload: 'emp_no,name,salary\nE1,Alice,100\n' });
    const datasetId = up.json().dataset.id as string;
    await server.app.inject({ method: 'POST', url: '/api/ontology/object-types', headers: admin, payload: { apiName: OT, datasetId, primaryKey: 'empNo', properties: [ { apiName: 'empNo', column: 'emp_no', type: 'string' }, { apiName: 'name', column: 'name', type: 'string' }, { apiName: 'salary', column: 'salary', type: 'int' } ] } });
    await server.app.inject({ method: 'POST', url: `/api/ontology/object-types/${OT}/properties/salary/security`, headers: admin, payload: { requiredPermission: 'pii:view' } });

    // admin (perm '*') sees salary
    const adminObjs = await server.app.inject({ method: 'GET', url: `/api/ontology/object-types/${OT}/objects`, headers: admin });
    const aRow = (adminObjs.json().objects as Array<Record<string, unknown>>)[0]!;
    expect(aRow.salary).toBe(100);
    expect(aRow.name).toBe('Alice');

    // create a limited user (role with only ontology:read) directly
    const roleId = randomUUID(); const userId = randomUUID();
    await db.query(`INSERT INTO roles(id,org_id,name) VALUES ($1,'org_default','limitedrole')`, [roleId]);
    await db.query(`INSERT INTO permissions(key) VALUES ('ontology:read') ON CONFLICT DO NOTHING`);
    await db.query(`INSERT INTO role_permissions(role_id,permission_key) VALUES ($1,'ontology:read')`, [roleId]);
    await db.query(`INSERT INTO users(id,org_id,email,password_hash) VALUES ($1,'org_default','limited@example.com',$2)`, [userId, hashPassword('pw')]);
    await db.query(`INSERT INTO user_roles(user_id,role_id) VALUES ($1,$2)`, [userId, roleId]);

    const limLogin = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'limited@example.com', password: 'pw' } });
    const lim = { cookie: cookieFrom(limLogin.headers['set-cookie']) };
    const limObjs = await server.app.inject({ method: 'GET', url: `/api/ontology/object-types/${OT}/objects`, headers: lim });
    const lRow = (limObjs.json().objects as Array<Record<string, unknown>>)[0]!;
    expect(lRow.name).toBe('Alice');     // unsecured property visible
    expect('salary' in lRow).toBe(false); // secured property masked
  });
});
