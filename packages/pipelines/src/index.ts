import { defineModule } from '@so/sdk';
import { runMigrations } from './migrate.js';
import { pipelineRoutes } from './routes.js';

export default defineModule({
  id: 'pipelines',
  dependsOn: ['datasets', 'auth'],
  contributes: { apiRoutes: pipelineRoutes, permissions: ['pipelines:read', 'pipelines:write'] },
  async onInstall(ctx) { await runMigrations(ctx.db); },
});

export { createPipelineService, type PipelineInput } from './service.js';
