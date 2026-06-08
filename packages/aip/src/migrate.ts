import { applyMigrations, type Db } from '@so/sdk';
const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS aip_embeddings (
    org_id      text NOT NULL,
    object_type text NOT NULL,
    primary_key text NOT NULL,
    doc         text NOT NULL,
    vector      jsonb NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (org_id, object_type, primary_key)
  )`,
];
export async function runMigrations(db: Db): Promise<void> { await applyMigrations(db, 'aip', MIGRATIONS); }
