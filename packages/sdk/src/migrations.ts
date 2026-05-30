import type { Db } from './types.js';

/**
 * Apply a module's schema DDL serially across concurrent kernel boots.
 *
 * Many kernels can run the same migrations against the same database at once: the
 * integration suite boots ~20 servers in parallel, and the containerized stack
 * starts the app, worker, and connector-runner together. On a fresh Postgres
 * volume those boots all execute the same `CREATE TABLE IF NOT EXISTS` /
 * `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements at the same time — which is
 * NOT concurrency-safe against pg_catalog. Creating the same table from two
 * connections at once raises a duplicate-key error on pg_type (or a "tuple
 * concurrently updated" error), which used to crash a booting server.
 *
 * Each migration set takes a transaction-scoped advisory lock keyed by module name,
 * so a given module's migration runs one boot at a time while the others wait; once
 * the first boot has created the tables, the IF-NOT-EXISTS statements no-op for
 * everyone else. The lock auto-releases when the transaction commits (or rolls back
 * on error), so it can never leak, and all of a module's statements run inside that
 * one transaction, so its tables are created atomically.
 *
 * @param name  Stable, unique label for this migration set — use the module id.
 */
export async function applyMigrations(db: Db, name: string, statements: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    // hashtext() maps the label to the int the advisory lock expects; distinct
    // modules get distinct locks, so disjoint table sets still migrate in parallel.
    await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`so:migrate:${name}`]);
    for (const sql of statements) await tx.query(sql);
  });
}
