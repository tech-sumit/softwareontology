import { defineModule } from '@so/sdk';
import { adminRoutes } from './routes.js';

export default defineModule({
  id: 'admin',
  dependsOn: ['auth'],
  contributes: {
    apiRoutes: adminRoutes,
    permissions: ['admin:users', 'admin:roles'],
  },
});

export { createAdminService, type UserSummary, type RoleSummary } from './service.js';
