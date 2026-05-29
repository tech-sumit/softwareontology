import { defineConfig } from 'vitest/config';

// Integration tests open a DuckDB session; on a COLD machine the first call
// downloads the json/postgres/httpfs extensions from the internet, which can
// exceed Vitest's default 5s budget. Generous timeouts keep CI (cold cache)
// green without weakening assertions.
export default defineConfig({
  test: {
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
