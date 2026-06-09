import { applyMigrations, type Db, type Config } from '@so/sdk';
import { hashPassword } from './password.js';

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS orgs (
     id text PRIMARY KEY,
     name text NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS users (
     id text PRIMARY KEY,
     org_id text NOT NULL REFERENCES orgs(id),
     email text NOT NULL,
     password_hash text NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     UNIQUE (org_id, email)
   )`,
  `CREATE TABLE IF NOT EXISTS roles (
     id text PRIMARY KEY,
     org_id text NOT NULL REFERENCES orgs(id),
     name text NOT NULL,
     UNIQUE (org_id, name)
   )`,
  `CREATE TABLE IF NOT EXISTS permissions (key text PRIMARY KEY)`,
  `CREATE TABLE IF NOT EXISTS role_permissions (
     role_id text NOT NULL REFERENCES roles(id),
     permission_key text NOT NULL REFERENCES permissions(key),
     PRIMARY KEY (role_id, permission_key)
   )`,
  `CREATE TABLE IF NOT EXISTS user_roles (
     user_id text NOT NULL REFERENCES users(id),
     role_id text NOT NULL REFERENCES roles(id),
     PRIMARY KEY (user_id, role_id)
   )`,
  `CREATE TABLE IF NOT EXISTS sessions (
     token text PRIMARY KEY,
     user_id text NOT NULL REFERENCES users(id),
     org_id text NOT NULL,
     expires_at timestamptz NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
];

export async function runMigrations(db: Db): Promise<void> {
  await applyMigrations(db, 'auth', MIGRATIONS);
}

/** Idempotently create the default org + admin role (perm '*') + admin user. */
export async function seed(db: Db, config: Config): Promise<void> {
  const email = config.get('ADMIN_EMAIL') ?? 'admin@example.com';
  const configuredPassword = config.get('ADMIN_PASSWORD');
  const password = configuredPassword ?? 'admin';
  if (!configuredPassword || configuredPassword === 'admin') {
    console.warn('[SECURITY] Default admin password in use — set ADMIN_PASSWORD before exposing this deployment.');
  }
  await db.query(`INSERT INTO orgs(id,name) VALUES ('org_default','Default') ON CONFLICT (id) DO NOTHING`);
  await db.query(`INSERT INTO permissions(key) VALUES ('*') ON CONFLICT DO NOTHING`);
  await db.query(`INSERT INTO roles(id,org_id,name) VALUES ('role_admin','org_default','admin') ON CONFLICT (org_id,name) DO NOTHING`);
  await db.query(`INSERT INTO role_permissions(role_id,permission_key) VALUES ('role_admin','*') ON CONFLICT DO NOTHING`);
  await db.query(
    `INSERT INTO users(id,org_id,email,password_hash) VALUES ('user_admin','org_default',$1,$2) ON CONFLICT (org_id,email) DO NOTHING`,
    [email, hashPassword(password)],
  );
  await db.query(`INSERT INTO user_roles(user_id,role_id) VALUES ('user_admin','role_admin') ON CONFLICT DO NOTHING`);
}
