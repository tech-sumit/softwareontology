import type { Db } from '@so/sdk';

export async function runMigrations(db: Db): Promise<void> {
  await db.query(`CREATE TABLE IF NOT EXISTS pipelines (
    id text PRIMARY KEY,
    org_id text NOT NULL,
    name text NOT NULL,
    sql text NOT NULL,
    inputs jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (org_id, name)
  )`);
  await db.query(`ALTER TABLE pipelines ADD COLUMN IF NOT EXISTS steps jsonb`);
}
