import { defineModule } from '@so/sdk';
import { catalogRoutes } from './routes.js';

export default defineModule({
  id: 'catalog',
  dependsOn: ['actions', 'ontology', 'datasets', 'auth'],
  contributes: { apiRoutes: catalogRoutes, permissions: ['catalog:read'] },
});

export { createCatalogService, type AuditEntry, type SearchHit } from './service.js';
