import { applyMigrations, type Db } from '@so/sdk';

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS dashboards (
     id text PRIMARY KEY,
     org_id text NOT NULL,
     name text NOT NULL,
     object_type text NOT NULL,
     group_by text NOT NULL,
     fn text NOT NULL DEFAULT 'count',
     property text,
     created_by text,
     created_at timestamptz NOT NULL DEFAULT now(),
     UNIQUE (org_id, name)
   )`,
];

export async function runMigrations(db: Db): Promise<void> {
  await applyMigrations(db, 'dashboards', MIGRATIONS);
}
