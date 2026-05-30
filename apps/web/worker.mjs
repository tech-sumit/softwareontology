// Worker entrypoint: runs the pg-boss job runner, binding any `jobs` contributed
// by modules. (No module registers jobs yet, so it idles until one does — it is
// part of the platform topology and ready for async work.)
import process from 'node:process';
import { createWorker } from '@so/worker';
import { createConfig } from '@so/server';
import { createLogger } from '@so/observability';
import { modules } from './modules.mjs';

const logger = createLogger();
const worker = await createWorker({ modules, logger, config: createConfig() });
await worker.start();
logger.info('SoftwareOntology worker started');

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, async () => {
    logger.info(`${sig} received, stopping worker`);
    await worker.stop().catch(() => {});
    process.exit(0);
  });
}
