import { defineModule } from '@so/sdk';
import { runMigrations } from './migrate.js';
import { actionRoutes } from './routes.js';

export default defineModule({
  id: 'actions',
  dependsOn: ['ontology', 'auth'],
  contributes: {
    apiRoutes: actionRoutes,
    permissions: ['actions:read', 'actions:edit', 'actions:execute'],
  },
  async onInstall(ctx) {
    await runMigrations(ctx.db);
  },
});

export { createActionService, type ActionDefInput, type ExecuteInput } from './service.js';
