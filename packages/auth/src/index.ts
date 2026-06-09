import { defineModule } from '@so/sdk';
import { runMigrations, seed } from './migrate.js';
import { authRoutes } from './routes.js';

export default defineModule({
  id: 'auth',
  contributes: {
    apiRoutes: authRoutes,
    permissions: ['auth:read'],
  },
  async onInstall(ctx) {
    await runMigrations(ctx.db);
    await seed(ctx.db, ctx.config);
  },
});

export { createAuthService, hasPermission, type AuthUser } from './service.js';
export { createOidcService } from './oidc.js';
export { hashPassword, verifyPassword } from './password.js';
export { SESSION_COOKIE } from './routes.js';
export { requirePermission, requireProjectMembership } from './guard.js';
