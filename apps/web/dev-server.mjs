// Run the full API for local UI development: `pnpm dev:api`
// Uses the shared production module list (modules.mjs) so dev never drifts from
// the container server/worker + the e2e warm-up.
import { createServer, createConfig } from '@so/server';
import { createLogger } from '@so/observability';
import { modules } from './modules.mjs';

const server = await createServer({ modules, logger: createLogger(), config: createConfig() });
const addr = await server.start(3000);
createLogger().info(`API listening at ${addr}`);
