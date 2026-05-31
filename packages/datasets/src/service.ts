import { randomUUID } from 'node:crypto';
import { writeFile, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModuleContext } from '@so/sdk';

export interface DatasetColumn { name: string; duckType: string; }
export interface DatasetMeta {
  id: string;
  name: string;
  objectKey: string;
  rowCount: number;
  columns: DatasetColumn[];
}

export function createDatasetService(ctx: ModuleContext) {
  async function ingest(
    orgId: string,
    projectId: string,
    name: string,
    format: 'csv' | 'parquet',
    bytes: Buffer,
  ): Promise<DatasetMeta> {
    const id = randomUUID();
    const objectKey = `${orgId}/datasets/${id}/data.parquet`;
    const s3url = ctx.objectStore.getObjectUrl(objectKey);
    const dir = await mkdtemp(join(tmpdir(), 'so-ingest-'));
    const tmpFile = join(dir, format === 'csv' ? 'in.csv' : 'in.parquet');
    await writeFile(tmpFile, bytes);
    const session = await ctx.query.open();
    try {
      const reader = format === 'csv' ? `read_csv_auto('${tmpFile}')` : `read_parquet('${tmpFile}')`;
      await session.all(`CREATE TEMP TABLE _ingest AS SELECT * FROM ${reader}`);
      const described = await session.all(`DESCRIBE _ingest`);
      const counted = await session.all(`SELECT count(*)::int AS n FROM _ingest`);
      await session.all(`COPY _ingest TO '${s3url}' (FORMAT parquet)`);

      const columns: DatasetColumn[] = described.map((c) => ({
        name: String(c.column_name),
        duckType: String(c.column_type),
      }));
      const rowCount = Number(counted[0]?.n ?? 0);

      await ctx.db.query(
        `INSERT INTO datasets(id,org_id,project_id,name,object_key,row_count) VALUES ($1,$2,$3,$4,$5,$6)`,
        [id, orgId, projectId, name, objectKey, rowCount],
      );
      for (let i = 0; i < columns.length; i++) {
        const col = columns[i]!;
        await ctx.db.query(
          `INSERT INTO dataset_columns(dataset_id,ordinal,name,duck_type) VALUES ($1,$2,$3,$4)`,
          [id, i, col.name, col.duckType],
        );
      }
      return { id, name, objectKey, rowCount, columns };
    } finally {
      await session.close();
      await rm(dir, { recursive: true, force: true });
    }
  }

  async function list(orgId: string, projectId: string): Promise<DatasetMeta[]> {
    const rows = await ctx.db.query<{ id: string; name: string; object_key: string; row_count: number }>(
      `SELECT id, name, object_key, row_count FROM datasets WHERE org_id = $1 AND project_id = $2 ORDER BY created_at DESC`,
      [orgId, projectId],
    );
    const out: DatasetMeta[] = [];
    for (const r of rows) out.push({ id: r.id, name: r.name, objectKey: r.object_key, rowCount: r.row_count, columns: await columnsFor(r.id) });
    return out;
  }

  async function get(orgId: string, id: string): Promise<DatasetMeta | null> {
    const rows = await ctx.db.query<{ id: string; name: string; object_key: string; row_count: number }>(
      `SELECT id, name, object_key, row_count FROM datasets WHERE org_id = $1 AND id = $2`,
      [orgId, id],
    );
    const r = rows[0];
    if (!r) return null;
    return { id: r.id, name: r.name, objectKey: r.object_key, rowCount: r.row_count, columns: await columnsFor(r.id) };
  }

  async function columnsFor(datasetId: string): Promise<DatasetColumn[]> {
    const rows = await ctx.db.query<{ name: string; duck_type: string }>(
      `SELECT name, duck_type FROM dataset_columns WHERE dataset_id = $1 ORDER BY ordinal`,
      [datasetId],
    );
    return rows.map((r) => ({ name: r.name, duckType: r.duck_type }));
  }

  async function preview(objectKey: string, limit = 50, offset = 0): Promise<Record<string, unknown>[]> {
    const s3url = ctx.objectStore.getObjectUrl(objectKey);
    const session = await ctx.query.open();
    try {
      const lim = Number.isInteger(limit) ? limit : 50;
      const off = Number.isInteger(offset) ? offset : 0;
      return await session.all(`SELECT * FROM read_parquet('${s3url}') LIMIT ${lim} OFFSET ${off}`);
    } finally {
      await session.close();
    }
  }

  return { ingest, list, get, preview };
}
