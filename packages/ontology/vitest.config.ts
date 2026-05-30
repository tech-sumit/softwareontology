import { defineConfig } from 'vitest/config';

// `fileParallelism: false` runs this package's integration test files
// sequentially. Both ontology.int.test.ts and functions.int.test.ts start a
// kernel, which runs `CREATE TABLE IF NOT EXISTS ...` migrations against the
// SAME shared Postgres. `CREATE TABLE IF NOT EXISTS` is not concurrency-safe in
// Postgres: two parallel workers racing to create the same table/type hit
// `duplicate key value violates unique constraint "pg_type_typname_nsp_index"`.
// Serializing the files avoids that race without weakening any assertions.
export default defineConfig({
  test: { testTimeout: 60_000, hookTimeout: 60_000, fileParallelism: false },
});
