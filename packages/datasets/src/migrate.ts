import { applyMigrations, type Db } from '@so/sdk';

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS datasets (
     id text PRIMARY KEY,
     org_id text NOT NULL,
     name text NOT NULL,
     object_key text NOT NULL,
     row_count int NOT NULL DEFAULT 0,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS dataset_columns (
     dataset_id text NOT NULL REFERENCES datasets(id),
     ordinal int NOT NULL,
     name text NOT NULL,
     duck_type text NOT NULL,
     PRIMARY KEY (dataset_id, ordinal)
   )`,
  `ALTER TABLE datasets ADD COLUMN IF NOT EXISTS project_id text NOT NULL DEFAULT 'project_default'`,
];

export async function runMigrations(db: Db): Promise<void> {
  await applyMigrations(db, 'datasets', MIGRATIONS);
}
