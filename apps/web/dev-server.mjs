// Run the full API for local UI development: `node apps/web/dev-server.mjs`
import { createServer, createConfig } from '@so/server';
import { createLogger } from '@so/observability';
import auth from '@so/auth';
import datasets from '@so/datasets';
import ontology from '@so/ontology';
import actions from '@so/actions';
import admin from '@so/admin';
import connectorsDb from '@so/connectors-db';
import pipelines from '@so/pipelines';
import catalog from '@so/catalog';
import lineage from '@so/lineage';
import dashboards from '@so/dashboards';
import aip from '@so/aip';
import automations from '@so/automations';

const server = await createServer({
  modules: [auth, datasets, ontology, actions, admin, connectorsDb, pipelines, catalog, lineage, dashboards, aip, automations],
  logger: createLogger(),
  config: createConfig(),
});
const addr = await server.start(3000);
createLogger().info(`API listening at ${addr}`);
