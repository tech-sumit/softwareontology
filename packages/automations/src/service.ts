import { randomUUID } from 'node:crypto';
import type { ModuleContext } from '@so/sdk';

const NAME_RE = /^[A-Za-z0-9_-]+$/;

export interface AutomationInput { name: string; triggerAction: string; thenAction: string; thenEdits: Record<string, unknown>; }

export function createAutomationService(ctx: ModuleContext) {
  async function createAutomation(orgId: string, projectId: string, input: AutomationInput): Promise<string> {
    if (!NAME_RE.test(input.name)) throw new Error('invalid automation name');
    if (!input.triggerAction || !input.thenAction) throw new Error('triggerAction and thenAction required');
    const id = randomUUID();
    await ctx.db.query(
      `INSERT INTO automations(id,org_id,name,trigger_action,then_action,then_edits,project_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, orgId, input.name, input.triggerAction, input.thenAction, JSON.stringify(input.thenEdits ?? {}), projectId],
    );
    return id;
  }

  async function listAutomations(orgId: string, projectId: string): Promise<Array<{ id: string; name: string; triggerAction: string; thenAction: string }>> {
    const rows = await ctx.db.query<{ id: string; name: string; trigger_action: string; then_action: string }>(
      `SELECT id, name, trigger_action, then_action FROM automations WHERE org_id = $1 AND project_id = $2 ORDER BY name`, [orgId, projectId],
    );
    return rows.map((r) => ({ id: r.id, name: r.name, triggerAction: r.trigger_action, thenAction: r.then_action }));
  }

  async function deleteAutomation(orgId: string, id: string): Promise<boolean> {
    const r = await ctx.db.query<{ id: string }>(`DELETE FROM automations WHERE org_id = $1 AND id = $2 RETURNING id`, [orgId, id]);
    return r.length > 0;
  }

  return { createAutomation, listAutomations, deleteAutomation };
}
