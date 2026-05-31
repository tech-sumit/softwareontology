import { randomUUID } from 'node:crypto';
import type { ModuleContext } from '@so/sdk';

const NAME_RE = /^[A-Za-z0-9 _:-]+$/;

export interface Marking { id: string; name: string; }

export function createGovernanceService(ctx: ModuleContext) {
  async function createMarking(orgId: string, name: string): Promise<string> {
    if (!name || !NAME_RE.test(name)) throw new Error('invalid marking name');
    const existing = await ctx.db.query<{ id: string }>(`SELECT id FROM markings WHERE org_id = $1 AND name = $2`, [orgId, name]);
    if (existing[0]) return existing[0].id;
    const id = randomUUID();
    await ctx.db.query(`INSERT INTO markings(id,org_id,name) VALUES ($1,$2,$3)`, [id, orgId, name]);
    return id;
  }

  async function listMarkings(orgId: string): Promise<Marking[]> {
    return ctx.db.query<Marking>(`SELECT id, name FROM markings WHERE org_id = $1 ORDER BY name`, [orgId]);
  }

  async function requireMarking(orgId: string, markingId: string): Promise<void> {
    const m = await ctx.db.query<{ id: string }>(`SELECT id FROM markings WHERE org_id = $1 AND id = $2`, [orgId, markingId]);
    if (!m[0]) throw new Error('marking not found');
  }

  async function applyToDataset(orgId: string, datasetId: string, markingId: string): Promise<void> {
    await requireMarking(orgId, markingId);
    await ctx.db.query(`INSERT INTO dataset_markings(dataset_id,marking_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [datasetId, markingId]);
  }

  async function grantToRole(orgId: string, roleId: string, markingId: string): Promise<void> {
    await requireMarking(orgId, markingId);
    await ctx.db.query(`INSERT INTO role_markings(role_id,marking_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [roleId, markingId]);
  }

  async function datasetMarkings(datasetId: string): Promise<Marking[]> {
    return ctx.db.query<Marking>(
      `SELECT m.id, m.name FROM dataset_markings dm JOIN markings m ON m.id = dm.marking_id WHERE dm.dataset_id = $1 ORDER BY m.name`, [datasetId],
    );
  }

  async function userClearances(userId: string): Promise<Marking[]> {
    return ctx.db.query<Marking>(
      `SELECT DISTINCT m.id, m.name FROM role_markings rm
         JOIN markings m ON m.id = rm.marking_id
        WHERE rm.role_id IN (SELECT role_id FROM user_roles WHERE user_id = $1) ORDER BY m.name`, [userId],
    );
  }

  async function canReadDataset(userId: string, datasetId: string): Promise<boolean> {
    const required = await ctx.db.query<{ marking_id: string }>(`SELECT marking_id FROM dataset_markings WHERE dataset_id = $1`, [datasetId]);
    if (required.length === 0) return true;
    const cleared = new Set((await ctx.db.query<{ marking_id: string }>(
      `SELECT DISTINCT marking_id FROM role_markings WHERE role_id IN (SELECT role_id FROM user_roles WHERE user_id = $1)`, [userId],
    )).map((r) => r.marking_id));
    return required.every((r) => cleared.has(r.marking_id));
  }

  /** Output dataset inherits the union of input datasets' markings (used by pipeline propagation, Plan 34). */
  async function propagateMarkings(inputDatasetIds: string[], outputDatasetId: string): Promise<void> {
    if (inputDatasetIds.length === 0) return;
    const rows = await ctx.db.query<{ marking_id: string }>(
      `SELECT DISTINCT marking_id FROM dataset_markings WHERE dataset_id = ANY($1)`, [inputDatasetIds],
    );
    for (const r of rows) {
      await ctx.db.query(`INSERT INTO dataset_markings(dataset_id,marking_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [outputDatasetId, r.marking_id]);
    }
  }

  return { createMarking, listMarkings, applyToDataset, grantToRole, datasetMarkings, userClearances, canReadDataset, propagateMarkings };
}
