import { applyMigrations, type Db } from '@so/sdk';

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS markings (
    id text PRIMARY KEY, org_id text NOT NULL, name text NOT NULL, UNIQUE (org_id, name)
  )`,
  `CREATE TABLE IF NOT EXISTS dataset_markings (
    dataset_id text NOT NULL, marking_id text NOT NULL, PRIMARY KEY (dataset_id, marking_id)
  )`,
  `CREATE TABLE IF NOT EXISTS role_markings (
    role_id text NOT NULL, marking_id text NOT NULL, PRIMARY KEY (role_id, marking_id)
  )`,
];

export async function runMigrations(db: Db): Promise<void> {
  await applyMigrations(db, 'governance', MIGRATIONS);
}
