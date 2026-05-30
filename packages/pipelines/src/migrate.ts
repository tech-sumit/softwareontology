import { applyMigrations, type Db } from '@so/sdk';

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS pipelines (
    id text PRIMARY KEY,
    org_id text NOT NULL,
    name text NOT NULL,
    sql text NOT NULL,
    inputs jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (org_id, name)
  )`,
  `ALTER TABLE pipelines ADD COLUMN IF NOT EXISTS steps jsonb`,
  `CREATE TABLE IF NOT EXISTS pipeline_runs (
    id text PRIMARY KEY,
    pipeline_id text NOT NULL,
    org_id text NOT NULL,
    status text NOT NULL,
    trigger text NOT NULL DEFAULT 'manual',
    dataset_id text,
    row_count integer,
    error text,
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz
  )`,
  `ALTER TABLE pipelines ADD COLUMN IF NOT EXISTS expectations jsonb`,
];

export async function runMigrations(db: Db): Promise<void> {
  await applyMigrations(db, 'pipelines', MIGRATIONS);
}
