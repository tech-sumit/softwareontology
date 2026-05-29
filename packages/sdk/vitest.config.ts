import { defineConfig } from 'vitest/config';

// Local config so `pnpm --filter @so/sdk test` works (vitest runs from the
// package dir). The root vitest.config.ts aggregates all packages via projects.
export default defineConfig({ test: {} });
