import type { Db } from '@so/sdk';
export async function runMigrations(db: Db): Promise<void> {
  await db.query(`CREATE TABLE IF NOT EXISTS airflow_connectors (
    id text PRIMARY KEY, org_id text NOT NULL, name text NOT NULL,
    provider text NOT NULL, conn text NOT NULL, query text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (org_id, name)
  )`);
}
