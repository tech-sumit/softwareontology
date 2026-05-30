import { defineModule } from '@so/sdk';
import { runMigrations } from './migrate.js';
import { appRoutes } from './routes.js';

export default defineModule({
  id: 'apps',
  dependsOn: ['auth'],
  contributes: { apiRoutes: appRoutes, permissions: ['apps:read', 'apps:write'] },
  async onInstall(ctx) { await runMigrations(ctx.db); },
});

export { validateDefinition, type AppDefinition, type AppWidget } from './definition.js';
export { createAppService, type AppSummary, type AppRecord } from './service.js';
