import type { Db } from '@so/sdk';

export async function runMigrations(db: Db): Promise<void> {
  await db.query(`CREATE TABLE IF NOT EXISTS db_connectors (
    id text PRIMARY KEY,
    org_id text NOT NULL,
    name text NOT NULL,
    source_conn_string text NOT NULL,
    source_table text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (org_id, name)
  )`);
}
