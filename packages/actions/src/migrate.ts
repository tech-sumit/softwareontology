import { applyMigrations, type Db } from '@so/sdk';

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS action_defs (
     id text PRIMARY KEY,
     org_id text NOT NULL,
     api_name text NOT NULL,
     object_type text NOT NULL,
     kind text NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     UNIQUE (org_id, api_name)
   )`,
  `CREATE TABLE IF NOT EXISTS audit_log (
     id text PRIMARY KEY,
     org_id text NOT NULL,
     actor text,
     action text NOT NULL,
     object_type text NOT NULL,
     primary_key text,
     params jsonb,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
];

export async function runMigrations(db: Db): Promise<void> {
  await applyMigrations(db, 'actions', MIGRATIONS);
}
