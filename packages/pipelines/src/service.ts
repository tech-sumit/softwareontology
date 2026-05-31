import { randomUUID } from 'node:crypto';
import { CronExpressionParser } from 'cron-parser';
import type { ModuleContext } from '@so/sdk';

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function guardSql(sql: string): void {
  if (sql.length > 2000) throw new Error('pipeline SQL too long');
  if (sql.includes(';') || sql.includes('--') || sql.includes('/*')) throw new Error('illegal characters in pipeline SQL');
}

function validateCron(cron: string): void {
  try { CronExpressionParser.parse(cron); } catch { throw new Error('invalid cron expression'); }
}

const EXP_TYPES = ['row_count_min', 'row_count_max', 'not_null', 'unique'];
function validateExpectations(input: unknown): Expectation[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw new Error('expectations must be an array');
  const out: Expectation[] = [];
  for (const e of input) {
    const exp = (e ?? {}) as { type?: string; value?: number; column?: string };
    if (!EXP_TYPES.includes(exp.type as string)) throw new Error(`unknown expectation type: ${String(exp.type)}`);
    if (exp.type === 'row_count_min' || exp.type === 'row_count_max') {
      if (typeof exp.value !== 'number' || !Number.isFinite(exp.value)) throw new Error(`${exp.type} requires a numeric value`);
      out.push({ type: exp.type, value: exp.value });
    } else {
      if (!exp.column || !NAME_RE.test(exp.column)) throw new Error(`${exp.type} requires a valid column name`);
      out.push({ type: exp.type as Expectation['type'], column: exp.column });
    }
  }
  return out;
}

export interface PipelineStep { name: string; sql: string; }
export interface Expectation { type: 'row_count_min' | 'row_count_max' | 'not_null' | 'unique'; value?: number; column?: string; }
export interface PipelineInput { name: string; inputs: string[]; sql?: string; steps?: PipelineStep[]; expectations?: Expectation[]; incremental?: boolean; watermarkColumn?: string; }

export function createPipelineService(ctx: ModuleContext) {
  async function createPipeline(orgId: string, input: PipelineInput): Promise<string> {
    if (!NAME_RE.test(input.name)) throw new Error('invalid pipeline name');
    if (!Array.isArray(input.inputs) || input.inputs.length === 0) throw new Error('at least one input dataset name required');
    for (const i of input.inputs) if (!NAME_RE.test(i)) throw new Error(`invalid input dataset name: ${i}`);
    const hasSteps = Array.isArray(input.steps) && input.steps.length > 0;
    if (hasSteps) {
      for (const s of input.steps!) { if (!NAME_RE.test(s.name)) throw new Error(`invalid step name: ${s.name}`); guardSql(s.sql); }
    } else {
      if (!input.sql) throw new Error('sql or steps required');
      guardSql(input.sql);
    }
    const expectations = validateExpectations(input.expectations);
    if (input.incremental) {
      if (hasSteps || !input.sql) throw new Error('incremental pipelines require sql (not steps)');
      if (input.inputs.length !== 1) throw new Error('incremental pipelines require exactly one input');
      if (!input.watermarkColumn || !NAME_RE.test(input.watermarkColumn)) throw new Error('incremental pipelines require a valid watermarkColumn');
    }
    const id = randomUUID();
    await ctx.db.query(
      `INSERT INTO pipelines(id,org_id,name,sql,inputs,steps,expectations,incremental,watermark_column) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, orgId, input.name, input.sql ?? '', JSON.stringify(input.inputs), hasSteps ? JSON.stringify(input.steps) : null, expectations.length ? JSON.stringify(expectations) : null, input.incremental ?? false, input.watermarkColumn ?? null],
    );
    return id;
  }

  async function listPipelines(orgId: string): Promise<Array<{ id: string; name: string; inputs: string[] }>> {
    const rows = await ctx.db.query<{ id: string; name: string; inputs: string[] }>(
      `SELECT id, name, inputs FROM pipelines WHERE org_id = $1 ORDER BY name`, [orgId],
    );
    return rows.map((r) => ({ id: r.id, name: r.name, inputs: r.inputs }));
  }

  async function run(orgId: string, pipelineId: string, trigger = 'manual'): Promise<{ datasetId: string; rowCount: number; runId: string }> {
    const p = await ctx.db.query<{ name: string; sql: string; inputs: string[]; steps: PipelineStep[] | null; expectations: Expectation[] | null; incremental: boolean; watermark_column: string | null; last_watermark: string | null; output_dataset_id: string | null }>(
      `SELECT name, sql, inputs, steps, expectations, incremental, watermark_column, last_watermark, output_dataset_id FROM pipelines WHERE org_id = $1 AND id = $2`, [orgId, pipelineId],
    );
    const pipe = p[0];
    if (!pipe) throw new Error('pipeline not found');

    const runId = randomUUID();
    await ctx.db.query(`INSERT INTO pipeline_runs(id,pipeline_id,org_id,status,trigger) VALUES ($1,$2,$3,'running',$4)`, [runId, pipelineId, orgId, trigger]);
    try {
      const datasetId = randomUUID();
      const objectKey = `${orgId}/datasets/${datasetId}/data.parquet`;
      const s3url = ctx.objectStore.getObjectUrl(objectKey);
      const session = await ctx.query.open();
      try {
        if (pipe.incremental) {
          if (!pipe.watermark_column) throw new Error('incremental pipeline missing watermark column');
          const inputName = pipe.inputs[0]!;
          if (!NAME_RE.test(inputName)) throw new Error(`invalid input name: ${inputName}`);
          const ds = await ctx.db.query<{ object_key: string }>(
            `SELECT object_key FROM datasets WHERE org_id = $1 AND name = $2 ORDER BY created_at DESC LIMIT 1`, [orgId, inputName],
          );
          if (!ds[0]) throw new Error(`input dataset not found: ${inputName}`);
          const inUrl = ctx.objectStore.getObjectUrl(ds[0].object_key);
          const desc = await session.all(`DESCRIBE SELECT * FROM read_parquet('${inUrl}')`);
          const wm = desc.find((c) => String((c as { column_name?: string }).column_name) === pipe.watermark_column);
          if (!wm) throw new Error(`watermark column not found: ${pipe.watermark_column}`);
          const wmType = String((wm as { column_type?: string }).column_type);
          const filter = pipe.last_watermark != null ? ` WHERE ${pipe.watermark_column} > CAST('${pipe.last_watermark}' AS ${wmType})` : '';
          await session.all(`CREATE OR REPLACE VIEW ${inputName} AS SELECT * FROM read_parquet('${inUrl}')${filter}`);
          await session.all(`CREATE TEMP TABLE _delta AS ${pipe.sql}`);
          const dCount = Number((await session.all(`SELECT count(*)::int AS n FROM _delta`))[0]?.n ?? 0);
          const maxRow = await session.all(`SELECT max(${pipe.watermark_column})::VARCHAR AS w FROM ${inputName}`);
          const newMax = (maxRow[0] as { w?: string | null })?.w ?? null;

          let outId = pipe.output_dataset_id;
          if (!outId) {
            outId = randomUUID();
            await ctx.db.query(`INSERT INTO datasets(id,org_id,name,object_key,row_count) VALUES ($1,$2,$3,$4,0)`, [outId, orgId, pipe.name, `${orgId}/datasets/${outId}/parts/*.parquet`]);
            const cols = await session.all(`DESCRIBE _delta`);
            for (let i = 0; i < cols.length; i++) { const col = cols[i]!; await ctx.db.query(`INSERT INTO dataset_columns(dataset_id,ordinal,name,duck_type) VALUES ($1,$2,$3,$4)`, [outId, i, String(col.column_name), String(col.column_type)]); }
            await ctx.db.query(`UPDATE pipelines SET output_dataset_id = $1 WHERE id = $2`, [outId, pipelineId]);
          }
          const partUrl = ctx.objectStore.getObjectUrl(`${orgId}/datasets/${outId}/parts/${runId}.parquet`);
          await session.all(`COPY _delta TO '${partUrl}' (FORMAT parquet)`);
          await ctx.db.query(`UPDATE datasets SET row_count = row_count + $1 WHERE id = $2`, [dCount, outId]);
          if (newMax != null) await ctx.db.query(`UPDATE pipelines SET last_watermark = $1 WHERE id = $2`, [newMax, pipelineId]);
          await ctx.db.query(`UPDATE pipeline_runs SET status='success', dataset_id=$1, row_count=$2, finished_at=now() WHERE id=$3`, [outId, dCount, runId]);
          return { datasetId: outId, rowCount: dCount, runId };
        }
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
        if (pipe.steps && pipe.steps.length > 0) {
          for (const step of pipe.steps) {
            if (!NAME_RE.test(step.name)) throw new Error(`invalid step name: ${step.name}`);
            guardSql(step.sql);
            await session.all(`CREATE OR REPLACE VIEW ${step.name} AS ${step.sql}`);
          }
          await session.all(`CREATE TEMP TABLE _out AS SELECT * FROM ${pipe.steps[pipe.steps.length - 1]!.name}`);
        } else {
          guardSql(pipe.sql);
          await session.all(`CREATE TEMP TABLE _out AS ${pipe.sql}`);
        }
        const described = await session.all(`DESCRIBE _out`);
        const counted = await session.all(`SELECT count(*)::int AS n FROM _out`);
        const rowCount = Number(counted[0]?.n ?? 0);
        for (const exp of pipe.expectations ?? []) {
          if (exp.type === 'row_count_min' && rowCount < (exp.value ?? 0)) throw new Error(`expectation failed: row_count_min(${exp.value}) — got ${rowCount}`);
          if (exp.type === 'row_count_max' && rowCount > (exp.value ?? 0)) throw new Error(`expectation failed: row_count_max(${exp.value}) — got ${rowCount}`);
          if (exp.type === 'not_null') {
            const r = await session.all(`SELECT count(*)::int AS n FROM _out WHERE ${exp.column} IS NULL`);
            if (Number((r[0] as { n?: number })?.n ?? 0) > 0) throw new Error(`expectation failed: not_null(${exp.column})`);
          }
          if (exp.type === 'unique') {
            const r = await session.all(`SELECT (count(*) - count(DISTINCT ${exp.column}))::int AS d FROM _out`);
            if (Number((r[0] as { d?: number })?.d ?? 0) > 0) throw new Error(`expectation failed: unique(${exp.column})`);
          }
        }
        await session.all(`COPY _out TO '${s3url}' (FORMAT parquet)`);

        await ctx.db.query(`INSERT INTO datasets(id,org_id,name,object_key,row_count) VALUES ($1,$2,$3,$4,$5)`, [datasetId, orgId, pipe.name, objectKey, rowCount]);
        for (let i = 0; i < described.length; i++) {
          const col = described[i]!;
          await ctx.db.query(`INSERT INTO dataset_columns(dataset_id,ordinal,name,duck_type) VALUES ($1,$2,$3,$4)`, [datasetId, i, String(col.column_name), String(col.column_type)]);
        }
        await ctx.db.query(`UPDATE pipeline_runs SET status='success', dataset_id=$1, row_count=$2, finished_at=now() WHERE id=$3`, [datasetId, rowCount, runId]);
        return { datasetId, rowCount, runId };
      } finally {
        await session.close();
      }
    } catch (e) {
      await ctx.db.query(`UPDATE pipeline_runs SET status='failed', error=$1, finished_at=now() WHERE id=$2`, [(e as Error).message, runId]);
      throw e;
    }
  }

  async function listRuns(orgId: string, pipelineId: string): Promise<Array<{ id: string; status: string; trigger: string; datasetId: string | null; rowCount: number | null; error: string | null; startedAt: string; finishedAt: string | null }>> {
    const rows = await ctx.db.query<{ id: string; status: string; trigger: string; dataset_id: string | null; row_count: number | null; error: string | null; started_at: string; finished_at: string | null }>(
      `SELECT id, status, trigger, dataset_id, row_count, error, started_at, finished_at FROM pipeline_runs WHERE org_id = $1 AND pipeline_id = $2 ORDER BY started_at DESC LIMIT 50`, [orgId, pipelineId],
    );
    return rows.map((r) => ({ id: r.id, status: r.status, trigger: r.trigger, datasetId: r.dataset_id, rowCount: r.row_count, error: r.error, startedAt: r.started_at, finishedAt: r.finished_at }));
  }

  async function getRun(orgId: string, runId: string): Promise<{ id: string; pipelineId: string; status: string; trigger: string; datasetId: string | null; rowCount: number | null; error: string | null; startedAt: string; finishedAt: string | null } | null> {
    const rows = await ctx.db.query<{ id: string; pipeline_id: string; status: string; trigger: string; dataset_id: string | null; row_count: number | null; error: string | null; started_at: string; finished_at: string | null }>(
      `SELECT id, pipeline_id, status, trigger, dataset_id, row_count, error, started_at, finished_at FROM pipeline_runs WHERE org_id = $1 AND id = $2`, [orgId, runId],
    );
    const r = rows[0];
    return r ? { id: r.id, pipelineId: r.pipeline_id, status: r.status, trigger: r.trigger, datasetId: r.dataset_id, rowCount: r.row_count, error: r.error, startedAt: r.started_at, finishedAt: r.finished_at } : null;
  }

  async function setSchedule(orgId: string, id: string, cron: string): Promise<boolean> {
    validateCron(cron);
    const r = await ctx.db.query<{ id: string }>(`UPDATE pipelines SET schedule = $1 WHERE org_id = $2 AND id = $3 RETURNING id`, [cron, orgId, id]);
    return r.length > 0;
  }
  async function clearSchedule(orgId: string, id: string): Promise<boolean> {
    const r = await ctx.db.query<{ id: string }>(`UPDATE pipelines SET schedule = NULL, last_run_at = NULL WHERE org_id = $1 AND id = $2 RETURNING id`, [orgId, id]);
    return r.length > 0;
  }

  return { createPipeline, listPipelines, run, listRuns, getRun, setSchedule, clearSchedule };
}
