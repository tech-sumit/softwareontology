import { randomUUID } from 'node:crypto';
import type { ModuleContext } from '@so/sdk';

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function guardSql(sql: string): void {
  if (sql.length > 2000) throw new Error('pipeline SQL too long');
  if (sql.includes(';') || sql.includes('--') || sql.includes('/*')) throw new Error('illegal characters in pipeline SQL');
}

export interface PipelineInput { name: string; inputs: string[]; sql: string; }

export function createPipelineService(ctx: ModuleContext) {
  async function createPipeline(orgId: string, input: PipelineInput): Promise<string> {
    if (!NAME_RE.test(input.name)) throw new Error('invalid pipeline name');
    if (!Array.isArray(input.inputs) || input.inputs.length === 0) throw new Error('at least one input dataset name required');
    for (const i of input.inputs) if (!NAME_RE.test(i)) throw new Error(`invalid input dataset name: ${i}`);
    guardSql(input.sql);
    const id = randomUUID();
    await ctx.db.query(
      `INSERT INTO pipelines(id,org_id,name,sql,inputs) VALUES ($1,$2,$3,$4,$5)`,
      [id, orgId, input.name, input.sql, JSON.stringify(input.inputs)],
    );
    return id;
  }

  async function listPipelines(orgId: string): Promise<Array<{ id: string; name: string; inputs: string[] }>> {
    const rows = await ctx.db.query<{ id: string; name: string; inputs: string[] }>(
      `SELECT id, name, inputs FROM pipelines WHERE org_id = $1 ORDER BY name`, [orgId],
    );
    return rows.map((r) => ({ id: r.id, name: r.name, inputs: r.inputs }));
  }

  async function run(orgId: string, pipelineId: string): Promise<{ datasetId: string; rowCount: number }> {
    const p = await ctx.db.query<{ name: string; sql: string; inputs: string[] }>(
      `SELECT name, sql, inputs FROM pipelines WHERE org_id = $1 AND id = $2`, [orgId, pipelineId],
    );
    const pipe = p[0];
    if (!pipe) throw new Error('pipeline not found');
    guardSql(pipe.sql);

    const datasetId = randomUUID();
    const objectKey = `${orgId}/datasets/${datasetId}/data.parquet`;
    const s3url = ctx.objectStore.getObjectUrl(objectKey);
    const session = await ctx.query.open();
    try {
      // create a DuckDB view per input dataset (latest with that name)
      for (const inputName of pipe.inputs) {
        if (!NAME_RE.test(inputName)) throw new Error(`invalid input name: ${inputName}`);
        const ds = await ctx.db.query<{ object_key: string }>(
          `SELECT object_key FROM datasets WHERE org_id = $1 AND name = $2 ORDER BY created_at DESC LIMIT 1`,
          [orgId, inputName],
        );
        if (!ds[0]) throw new Error(`input dataset not found: ${inputName}`);
        const url = ctx.objectStore.getObjectUrl(ds[0].object_key);
        await session.all(`CREATE OR REPLACE VIEW ${inputName} AS SELECT * FROM read_parquet('${url}')`);
      }
      await session.all(`CREATE TEMP TABLE _out AS ${pipe.sql}`);
      const described = await session.all(`DESCRIBE _out`);
      const counted = await session.all(`SELECT count(*)::int AS n FROM _out`);
      await session.all(`COPY _out TO '${s3url}' (FORMAT parquet)`);
      const rowCount = Number(counted[0]?.n ?? 0);

      await ctx.db.query(`INSERT INTO datasets(id,org_id,name,object_key,row_count) VALUES ($1,$2,$3,$4,$5)`, [datasetId, orgId, pipe.name, objectKey, rowCount]);
      for (let i = 0; i < described.length; i++) {
        const col = described[i]!;
        await ctx.db.query(`INSERT INTO dataset_columns(dataset_id,ordinal,name,duck_type) VALUES ($1,$2,$3,$4)`, [datasetId, i, String(col.column_name), String(col.column_type)]);
      }
      return { datasetId, rowCount };
    } finally {
      await session.close();
    }
  }

  return { createPipeline, listPipelines, run };
}
