import { defineModule } from '@so/sdk';
import { runMigrations } from './migrate.js';
import { connectorRoutes } from './routes.js';

export default defineModule({
  id: 'connectors-db',
  dependsOn: ['datasets', 'auth'],
  contributes: { apiRoutes: connectorRoutes, permissions: ['connectors:read', 'connectors:write'] },
  async onInstall(ctx) { await runMigrations(ctx.db); },
});

export { createConnectorService, type ConnectorInput } from './service.js';
