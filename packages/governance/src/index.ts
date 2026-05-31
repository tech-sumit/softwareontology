import { defineModule } from '@so/sdk';
import { runMigrations } from './migrate.js';
import { governanceRoutes } from './routes.js';
import { createGovernanceService } from './service.js';

export default defineModule({
  id: 'governance',
  dependsOn: ['auth'],
  contributes: {
    apiRoutes: governanceRoutes,
    permissions: ['governance:read', 'governance:manage'],
    datasetAccessPolicies: [{ check: (ctx, userId, datasetId) => createGovernanceService(ctx).canReadDataset(userId, datasetId) }],
  },
  async onInstall(ctx) { await runMigrations(ctx.db); },
});

export { createGovernanceService, type Marking } from './service.js';
