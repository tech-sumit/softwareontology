import { defineModule } from '@so/sdk';
import { createActionService } from '@so/actions';
import { runMigrations } from './migrate.js';
import { automationRoutes } from './routes.js';

export default defineModule({
  id: 'automations',
  dependsOn: ['actions', 'auth'],
  contributes: { apiRoutes: automationRoutes, permissions: ['automations:read', 'automations:write'] },
  async onInstall(ctx) { await runMigrations(ctx.db); },
  async onStart(ctx) {
    const actions = createActionService(ctx);
    ctx.events.on('action.executed', (payload) => {
      const p = payload as { orgId: string; apiName: string; primaryKey: string };
      void (async () => {
        const autos = await ctx.db.query<{ then_action: string; then_edits: Record<string, unknown> }>(
          `SELECT then_action, then_edits FROM automations WHERE org_id = $1 AND trigger_action = $2`, [p.orgId, p.apiName],
        );
        for (const a of autos) {
          try { await actions.execute(p.orgId, 'automation', a.then_action, { primaryKey: p.primaryKey, edits: a.then_edits }); }
          catch (e) { ctx.log.warn('automation failed', { err: (e as Error).message }); }
        }
      })();
    });
  },
});

export { createAutomationService, type AutomationInput } from './service.js';
