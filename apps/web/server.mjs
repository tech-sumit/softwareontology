// Production entrypoint: full API + built web UI (served from UI_DIST), all modules.
// Binds 0.0.0.0 and honours PORT (server.start() defaults handle both).
import process from 'node:process';
import { createServer, createConfig } from '@so/server';
import { createLogger } from '@so/observability';
import { modules } from './modules.mjs';

const logger = createLogger();
const server = await createServer({ modules, logger, config: createConfig() });
const addr = await server.start();
logger.info(`SoftwareOntology API listening at ${addr}`);

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, async () => {
    logger.info(`${sig} received, shutting down`);
    await server.stop().catch(() => {});
    process.exit(0);
  });
}
