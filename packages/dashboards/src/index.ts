import { defineModule } from '@so/sdk';
import { dashboardRoutes } from './routes.js';

export default defineModule({
  id: 'dashboards',
  dependsOn: ['ontology', 'auth'],
  contributes: { apiRoutes: dashboardRoutes, permissions: ['dashboards:read'] },
});

export { createDashboardService, type Bucket } from './service.js';
