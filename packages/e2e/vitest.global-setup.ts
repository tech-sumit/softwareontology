// Vitest GLOBAL setup — wired from the root config (vitest.config.ts) so it runs
// ONCE before the per-package projects fan out.
//
// The integration tests each boot a server and call `kernel.start()`, which runs
// every module's `CREATE TABLE IF NOT EXISTS` migrations. Vitest runs those test
// files in parallel, so on a fresh Postgres volume ~20 servers would otherwise
// race the same DDL against an empty database — and pg_catalog is not
// concurrency-safe for IF-NOT-EXISTS DDL (duplicate-key / "tuple concurrently
// updated"), so some boots would fail and their tests would crash.
//
// Here we boot a single server with the full production module list and run every
// migration serially, so the tables already exist by the time the parallel tests
// run; their IF-NOT-EXISTS statements then no-op. This warm-up is best-effort: the
// migrations themselves are also guarded by a per-module advisory lock (see @so/sdk
// `applyMigrations`), which is the actual correctness guarantee — so if the database
// is unreachable here we log and continue rather than failing the whole run (e.g.
// someone running only unit-test projects without infra up).
//
// It lives in @so/e2e because that package already depends on @so/server /
// @so/observability; the relative import of apps/web/modules.mjs keeps the module
// list identical to what the production server and worker boot with.
import { createServer, createConfig } from '@so/server';
import { createLogger } from '@so/observability';
import { modules } from '../../apps/web/modules.mjs';

export default async function warmDatabase(): Promise<void> {
  const config = createConfig({
    DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so',
    S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'localhost:9000',
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
    S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin',
    S3_BUCKET: process.env.S3_BUCKET ?? 'so-datasets',
    ADMIN_EMAIL: process.env.ADMIN_EMAIL ?? 'admin@example.com',
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ?? 'admin',
  });

  let server: Awaited<ReturnType<typeof createServer>> | undefined;
  try {
    server = await createServer({ modules, logger: createLogger(), config });
    await server.kernel.start(); // runs every module's migrations serially
    console.info('[vitest] database warm-up complete — all module migrations applied');
  } catch (err) {
    console.warn(
      `[vitest] database warm-up skipped: ${(err as Error).message}. ` +
        'Each test boot still applies migrations safely (serialized by the advisory ' +
        'lock in @so/sdk applyMigrations).',
    );
  } finally {
    await server?.stop().catch(() => {});
  }
}
