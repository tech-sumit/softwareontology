import { defineModule } from '@so/sdk';
import { runMigrations } from './migrate.js';
import { dashboardRoutes } from './routes.js';

export default defineModule({
  id: 'dashboards',
  dependsOn: ['ontology', 'auth'],
  contributes: { apiRoutes: dashboardRoutes, permissions: ['dashboards:read', 'dashboards:write'] },
  async onInstall(ctx) {
    await runMigrations(ctx.db);
  },
});

export { createDashboardService, type Bucket, type MetricFn, type SavedDashboard } from './service.js';
