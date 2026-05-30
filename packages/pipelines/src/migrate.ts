import type { Db } from '@so/sdk';

export async function runMigrations(db: Db): Promise<void> {
  // Serialize concurrent migrations (e.g. parallel test workers against a shared DB):
  // `CREATE TABLE IF NOT EXISTS` is not race-safe and can raise a duplicate-key error on
  // pg_type when two connections create the same table at once. A txn-scoped advisory lock
  // makes this migration run one-at-a-time; the lock auto-releases on COMMIT/ROLLBACK.
  await db.transaction(async (tx) => {
    await tx.query(`SELECT pg_advisory_xact_lock(hashtext('so:migrate:pipelines'))`);
    await tx.query(`CREATE TABLE IF NOT EXISTS pipelines (
      id text PRIMARY KEY,
      org_id text NOT NULL,
      name text NOT NULL,
      sql text NOT NULL,
      inputs jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (org_id, name)
    )`);
    await tx.query(`ALTER TABLE pipelines ADD COLUMN IF NOT EXISTS steps jsonb`);
    await tx.query(`CREATE TABLE IF NOT EXISTS pipeline_runs (
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
    )`);
  });
}
