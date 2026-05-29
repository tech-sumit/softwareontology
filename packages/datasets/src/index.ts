import { defineModule } from '@so/sdk';
import { runMigrations } from './migrate.js';
import { datasetRoutes } from './routes.js';

export default defineModule({
  id: 'datasets',
  dependsOn: ['auth'],
  contributes: {
    apiRoutes: datasetRoutes,
    permissions: ['datasets:read', 'datasets:write'],
  },
  async onInstall(ctx) {
    await runMigrations(ctx.db);
  },
});

export { createDatasetService, type DatasetMeta, type DatasetColumn } from './service.js';
