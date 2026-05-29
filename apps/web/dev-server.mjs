// Run the full API for local UI development: `node apps/web/dev-server.mjs`
import { createServer, createConfig } from '@so/server';
import { createLogger } from '@so/observability';
import auth from '@so/auth';
import datasets from '@so/datasets';
import ontology from '@so/ontology';
import actions from '@so/actions';

const server = await createServer({
  modules: [auth, datasets, ontology, actions],
  logger: createLogger(),
  config: createConfig(),
});
const addr = await server.start(3000);
createLogger().info(`API listening at ${addr}`);
