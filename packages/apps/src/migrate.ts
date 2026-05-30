import type { Db } from '@so/sdk';
export async function runMigrations(db: Db): Promise<void> {
  await db.query(`CREATE TABLE IF NOT EXISTS apps (
    id text PRIMARY KEY, org_id text NOT NULL, name text NOT NULL,
    definition jsonb NOT NULL DEFAULT '{"widgets":[]}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (org_id, name)
  )`);
}
