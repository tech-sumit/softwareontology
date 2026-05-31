import { applyMigrations, type Db } from '@so/sdk';

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS automations (
    id text PRIMARY KEY,
    org_id text NOT NULL,
    name text NOT NULL,
    trigger_action text NOT NULL,
    then_action text NOT NULL,
    then_edits jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (org_id, name)
  )`,
  `ALTER TABLE automations ADD COLUMN IF NOT EXISTS project_id text NOT NULL DEFAULT 'project_default'`,
];

export async function runMigrations(db: Db): Promise<void> {
  await applyMigrations(db, 'automations', MIGRATIONS);
}
