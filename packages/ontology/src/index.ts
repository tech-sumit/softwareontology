import { defineModule } from '@so/sdk';
import { runMigrations } from './migrate.js';
import { ontologyRoutes } from './routes.js';

export default defineModule({
  id: 'ontology',
  dependsOn: ['datasets', 'auth'],
  contributes: {
    apiRoutes: ontologyRoutes,
    permissions: ['ontology:read', 'ontology:edit'],
  },
  async onInstall(ctx) {
    await runMigrations(ctx.db);
  },
});

export { createOntologyService, type ObjectTypeInput, type ObjectTypeDetail } from './service.js';
