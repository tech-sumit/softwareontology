import { applyMigrations, type Db } from '@so/sdk';

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS apps (
    id text PRIMARY KEY, org_id text NOT NULL, name text NOT NULL,
    definition jsonb NOT NULL DEFAULT '{"widgets":[]}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (org_id, name)
  )`,
  `ALTER TABLE apps ADD COLUMN IF NOT EXISTS project_id text NOT NULL DEFAULT 'project_default'`,
];

export async function runMigrations(db: Db): Promise<void> {
  await applyMigrations(db, 'apps', MIGRATIONS);
}
