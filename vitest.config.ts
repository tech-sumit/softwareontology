import { defineConfig } from 'vitest/config';

// Root config. `test.projects` replaces the deprecated vitest.workspace.ts;
// each matched package keeps its own vitest.config.ts (e.g. @so/query's
// extended timeout for cold DuckDB extension downloads).
export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*'],
    // Runs ONCE before the projects fan out: warms the database so parallel
    // integration tests don't race each other's CREATE TABLE migrations on a cold
    // volume. Lives in @so/e2e so it can resolve @so/server. See that file.
    globalSetup: ['./packages/e2e/vitest.global-setup.ts'],
  },
});
