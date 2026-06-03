import { applyMigrations, type Db } from '@so/sdk';

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS projects (
    id text PRIMARY KEY,
    org_id text NOT NULL,
    name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (org_id, name)
  )`,
  `INSERT INTO projects(id, org_id, name) VALUES ('project_default', 'org_default', 'Default') ON CONFLICT DO NOTHING`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS description text`,
];

export async function runMigrations(db: Db): Promise<void> {
  await applyMigrations(db, 'projects', MIGRATIONS);
}
