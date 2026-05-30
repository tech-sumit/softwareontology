import { defineModule } from '@so/sdk';
import { aipRoutes } from './routes.js';

export default defineModule({
  id: 'aip',
  dependsOn: ['ontology', 'auth'],
  contributes: { apiRoutes: aipRoutes, permissions: ['aip:use'] },
});

export { createAipService } from './service.js';
