import { defineModule } from '@so/sdk';
import { runMigrations } from './migrate.js';
import { pipelineRoutes } from './routes.js';
import { runDuePipelines } from './scheduler.js';

export default defineModule({
  id: 'pipelines',
  dependsOn: ['datasets', 'auth'],
  contributes: {
    apiRoutes: pipelineRoutes,
    permissions: ['pipelines:read', 'pipelines:write'],
    jobs: [{ name: 'pipeline.tick', handler: async (ctx) => { await runDuePipelines(ctx, new Date()); } }],
    schedules: [{ name: 'pipeline.tick', cron: '* * * * *' }],
  },
  async onInstall(ctx) { await runMigrations(ctx.db); },
});

export { createPipelineService, type PipelineInput, type PipelineStep, type Expectation } from './service.js';
export { isDue, runDuePipelines } from './scheduler.js';
