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
  `ALTER TABLE pipelines ADD COLUMN IF NOT EXISTS schedule text`,
  `ALTER TABLE pipelines ADD COLUMN IF NOT EXISTS last_run_at timestamptz`,
  `ALTER TABLE pipelines ADD COLUMN IF NOT EXISTS incremental boolean NOT NULL DEFAULT false`,
  `ALTER TABLE pipelines ADD COLUMN IF NOT EXISTS watermark_column text`,
  `ALTER TABLE pipelines ADD COLUMN IF NOT EXISTS last_watermark text`,
  `ALTER TABLE pipelines ADD COLUMN IF NOT EXISTS output_dataset_id text`,
  `ALTER TABLE pipelines ADD COLUMN IF NOT EXISTS project_id text NOT NULL DEFAULT 'project_default'`,
];

export async function runMigrations(db: Db): Promise<void> {
  await applyMigrations(db, 'pipelines', MIGRATIONS);
}
