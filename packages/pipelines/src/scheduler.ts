import { CronExpressionParser } from 'cron-parser';
import type { ModuleContext } from '@so/sdk';
import { createPipelineService } from './service.js';

/** Most recent scheduled time <= now; due if we haven't run since then. */
export function isDue(cron: string, lastRunAt: Date | null, now: Date): boolean {
  const prev = CronExpressionParser.parse(cron, { currentDate: now }).prev().toDate();
  return lastRunAt === null || lastRunAt.getTime() < prev.getTime();
}

/** Run every scheduled pipeline whose cron is due; returns the ids that ran. */
export async function runDuePipelines(ctx: ModuleContext, now: Date): Promise<string[]> {
  const svc = createPipelineService(ctx);
  const rows = await ctx.db.query<{ id: string; org_id: string; schedule: string; last_run_at: string | null }>(
    `SELECT id, org_id, schedule, last_run_at FROM pipelines WHERE schedule IS NOT NULL`,
  );
  const ran: string[] = [];
  for (const r of rows) {
    if (!isDue(r.schedule, r.last_run_at ? new Date(r.last_run_at) : null, now)) continue;
    try { await svc.run(r.org_id, r.id, 'schedule'); } catch { /* run() already recorded the failure */ }
    await ctx.db.query(`UPDATE pipelines SET last_run_at = $1 WHERE id = $2`, [now.toISOString(), r.id]);
    ran.push(r.id);
  }
  return ran;
}
