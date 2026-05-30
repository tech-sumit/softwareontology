import { defineModule } from '@so/sdk';
import { lineageRoutes } from './routes.js';

export default defineModule({
  id: 'lineage',
  dependsOn: ['ontology', 'datasets', 'actions', 'auth'],
  contributes: { apiRoutes: lineageRoutes },
});

export { createLineageService, type ObjectTypeLineage } from './service.js';
