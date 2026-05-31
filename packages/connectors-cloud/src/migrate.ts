import { applyMigrations, type Db } from '@so/sdk';

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS cloud_connectors (
    id text PRIMARY KEY, org_id text NOT NULL, name text NOT NULL,
    kind text NOT NULL, config jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (org_id, name)
  )`,
  `ALTER TABLE cloud_connectors ADD COLUMN IF NOT EXISTS project_id text NOT NULL DEFAULT 'project_default'`,
];

export async function runMigrations(db: Db): Promise<void> {
  await applyMigrations(db, 'connectors-cloud', MIGRATIONS);
}
