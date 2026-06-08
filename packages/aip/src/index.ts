import { defineModule } from '@so/sdk';
import { runMigrations } from './migrate.js';
import { aipRoutes } from './routes.js';

export default defineModule({
  id: 'aip',
  dependsOn: ['ontology', 'auth'],
  contributes: { apiRoutes: aipRoutes, permissions: ['aip:use'] },
  async onInstall(ctx) {
    await runMigrations(ctx.db);
  },
});

export { createAipService } from './service.js';
