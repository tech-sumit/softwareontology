import { defineConfig } from 'vitest/config';

// Root config. `test.projects` replaces the deprecated vitest.workspace.ts;
// each matched package keeps its own vitest.config.ts (e.g. @so/query's
// extended timeout for cold DuckDB extension downloads).
export default defineConfig({
  test: {
    projects: ['packages/*'],
  },
});
