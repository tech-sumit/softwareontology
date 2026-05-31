import { defineModule } from '@so/sdk';
import { runMigrations } from './migrate.js';
import { projectRoutes } from './routes.js';

export default defineModule({
  id: 'projects',
  dependsOn: ['auth'],
  contributes: { apiRoutes: projectRoutes, permissions: ['projects:read', 'projects:write'] },
  async onInstall(ctx) { await runMigrations(ctx.db); },
});

export { createProjectService, type Project } from './service.js';
