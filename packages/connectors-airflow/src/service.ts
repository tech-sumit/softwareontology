import { randomUUID } from 'node:crypto';
import { writeFile, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModuleContext } from '@so/sdk';

const NAME_RE = /^[A-Za-z0-9_-]+$/;

export interface AirflowConnectorInput { name: string; provider: string; conn: string; query: string; }

export function createAirflowConnectorService(ctx: ModuleContext) {
  function runnerUrl(): string { return ctx.config.get('CONNECTOR_RUNNER_URL') ?? 'http://localhost:8077'; }

  async function createConnector(orgId: string, projectId: string, input: AirflowConnectorInput): Promise<string> {
    if (!NAME_RE.test(input.name)) throw new Error('invalid connector name');
    if (!input.provider || !input.conn || !input.query) throw new Error('provider, conn, query required');
    const id = randomUUID();
    await ctx.db.query(`INSERT INTO airflow_connectors(id,org_id,project_id,name,provider,conn,query) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id, orgId, projectId, input.name, input.provider, input.conn, input.query]);
    return id;
  }

  async function listConnectors(orgId: string, projectId: string): Promise<Array<{ id: string; name: string; provider: string }>> {
    const rows = await ctx.db.query<{ id: string; name: string; provider: string }>(`SELECT id, name, provider FROM airflow_connectors WHERE org_id = $1 AND project_id = $2 ORDER BY name`, [orgId, projectId]);
    return rows.map((r) => ({ id: r.id, name: r.name, provider: r.provider }));
  }

  async function sync(orgId: string, id: string): Promise<{ datasetId: string; rowCount: number }> {
    const rows = await ctx.db.query<{ name: string; provider: string; conn: string; query: string }>(`SELECT name, provider, conn, query FROM airflow_connectors WHERE org_id = $1 AND id = $2`, [orgId, id]);
    const c = rows[0];
    if (!c) throw new Error('connector not found');
    const res = await fetch(`${runnerUrl()}/extract`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: c.provider, conn: c.conn, query: c.query }) });
    if (!res.ok) throw new Error(`connector-runner error: ${res.status}`);
    const data = (await res.json()) as { rows?: unknown };
    if (!Array.isArray(data.rows)) throw new Error('runner did not return rows[]');

    const datasetId = randomUUID();
    const objectKey = `${orgId}/datasets/${datasetId}/data.parquet`;
    const s3out = ctx.objectStore.getObjectUrl(objectKey);
    const dir = await mkdtemp(join(tmpdir(), 'so-airflow-'));
    const file = join(dir, 'data.json');
    await writeFile(file, JSON.stringify(data.rows));
    const session = await ctx.query.open();
    try {
      await session.all(`CREATE TEMP TABLE _ingest AS SELECT * FROM read_json_auto('${file}')`);
      const described = await session.all(`DESCRIBE _ingest`);
      const counted = await session.all(`SELECT count(*)::int AS n FROM _ingest`);
      await session.all(`COPY _ingest TO '${s3out}' (FORMAT parquet)`);
      const rowCount = Number(counted[0]?.n ?? 0);
      await ctx.db.query(`INSERT INTO datasets(id,org_id,name,object_key,row_count) VALUES ($1,$2,$3,$4,$5)`, [datasetId, orgId, c.name, objectKey, rowCount]);
      for (let i = 0; i < described.length; i++) { const col = described[i]!; await ctx.db.query(`INSERT INTO dataset_columns(dataset_id,ordinal,name,duck_type) VALUES ($1,$2,$3,$4)`, [datasetId, i, String(col.column_name), String(col.column_type)]); }
      return { datasetId, rowCount };
    } finally { await session.close(); await rm(dir, { recursive: true, force: true }); }
  }

  return { createConnector, listConnectors, sync };
}
