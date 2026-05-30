import { defineModule } from '@so/sdk';
import { runMigrations } from './migrate.js';
import { cloudConnectorRoutes } from './routes.js';

export default defineModule({
  id: 'connectors-cloud',
  dependsOn: ['datasets', 'auth'],
  contributes: { apiRoutes: cloudConnectorRoutes, permissions: ['connectors:read', 'connectors:write'] },
  async onInstall(ctx) { await runMigrations(ctx.db); },
});

export { createCloudConnectorService, type CloudConnectorInput } from './service.js';
