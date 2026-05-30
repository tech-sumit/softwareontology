import { defineModule } from '@so/sdk';
import { runMigrations } from './migrate.js';
import { airflowConnectorRoutes } from './routes.js';

export default defineModule({
  id: 'connectors-airflow',
  dependsOn: ['datasets', 'auth'],
  contributes: { apiRoutes: airflowConnectorRoutes, permissions: ['connectors:read', 'connectors:write'] },
  async onInstall(ctx) { await runMigrations(ctx.db); },
});

export { createAirflowConnectorService, type AirflowConnectorInput } from './service.js';
