import { randomUUID } from 'node:crypto';
import { writeFile, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModuleContext } from '@so/sdk';

const NAME_RE = /^[A-Za-z0-9_-]+$/;

export interface CloudConnectorInput { name: string; kind: 's3' | 'rest'; config: Record<string, unknown>; }

export function createCloudConnectorService(ctx: ModuleContext) {
  async function createConnector(orgId: string, input: CloudConnectorInput): Promise<string> {
    if (!NAME_RE.test(input.name)) throw new Error('invalid connector name');
    if (input.kind !== 's3' && input.kind !== 'rest') throw new Error('kind must be s3|rest');
    const id = randomUUID();
    await ctx.db.query(`INSERT INTO cloud_connectors(id,org_id,name,kind,config) VALUES ($1,$2,$3,$4,$5)`, [id, orgId, input.name, input.kind, JSON.stringify(input.config ?? {})]);
    return id;
  }

  async function listConnectors(orgId: string): Promise<Array<{ id: string; name: string; kind: string }>> {
    const rows = await ctx.db.query<{ id: string; name: string; kind: string }>(`SELECT id, name, kind FROM cloud_connectors WHERE org_id = $1 ORDER BY name`, [orgId]);
    return rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind }));
  }

  async function register(orgId: string, name: string, session: { all(sql: string, ...p: unknown[]): Promise<Record<string, unknown>[]> }): Promise<{ datasetId: string; rowCount: number }> {
    const datasetId = randomUUID();
    const objectKey = `${orgId}/datasets/${datasetId}/data.parquet`;
    const s3out = ctx.objectStore.getObjectUrl(objectKey);
    const described = await session.all(`DESCRIBE _ingest`);
    const counted = await session.all(`SELECT count(*)::int AS n FROM _ingest`);
    await session.all(`COPY _ingest TO '${s3out}' (FORMAT parquet)`);
    const rowCount = Number(counted[0]?.n ?? 0);
    await ctx.db.query(`INSERT INTO datasets(id,org_id,name,object_key,row_count) VALUES ($1,$2,$3,$4,$5)`, [datasetId, orgId, name, objectKey, rowCount]);
    for (let i = 0; i < described.length; i++) { const c = described[i]!; await ctx.db.query(`INSERT INTO dataset_columns(dataset_id,ordinal,name,duck_type) VALUES ($1,$2,$3,$4)`, [datasetId, i, String(c.column_name), String(c.column_type)]); }
    return { datasetId, rowCount };
  }

  async function sync(orgId: string, id: string): Promise<{ datasetId: string; rowCount: number }> {
    const rows = await ctx.db.query<{ name: string; kind: string; config: Record<string, unknown> }>(`SELECT name, kind, config FROM cloud_connectors WHERE org_id = $1 AND id = $2`, [orgId, id]);
    const conn = rows[0];
    if (!conn) throw new Error('connector not found');

    if (conn.kind === 's3') {
      const s3Url = String(conn.config.s3Url ?? '');
      const format = conn.config.format === 'parquet' ? 'parquet' : 'csv';
      if (!s3Url.startsWith('s3://')) throw new Error('config.s3Url must be an s3:// URL');
      const session = await ctx.query.open();
      try {
        const reader = format === 'parquet' ? `read_parquet('${s3Url}')` : `read_csv_auto('${s3Url}')`;
        await session.all(`CREATE TEMP TABLE _ingest AS SELECT * FROM ${reader}`);
        return await register(orgId, conn.name, session);
      } finally { await session.close(); }
    }

    // rest
    const url = String(conn.config.url ?? '');
    if (!/^https?:\/\//.test(url)) throw new Error('config.url must be an http(s) URL');
    const arrayPath = conn.config.arrayPath ? String(conn.config.arrayPath) : undefined;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`REST source error: ${res.status}`);
    const data = (await res.json()) as unknown;
    const arr = arrayPath ? (data as Record<string, unknown>)[arrayPath] : data;
    if (!Array.isArray(arr)) throw new Error('REST source did not return a JSON array');
    const dir = await mkdtemp(join(tmpdir(), 'so-rest-'));
    const file = join(dir, 'data.json');
    await writeFile(file, JSON.stringify(arr));
    const session = await ctx.query.open();
    try {
      await session.all(`CREATE TEMP TABLE _ingest AS SELECT * FROM read_json_auto('${file}')`);
      return await register(orgId, conn.name, session);
    } finally { await session.close(); await rm(dir, { recursive: true, force: true }); }
  }

  return { createConnector, listConnectors, sync };
}
