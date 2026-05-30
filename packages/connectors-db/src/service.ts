import { randomUUID } from 'node:crypto';
import type { ModuleContext } from '@so/sdk';

const NAME_RE = /^[A-Za-z0-9_-]+$/;
const TABLE_RE = /^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/;

export interface ConnectorInput { name: string; sourceConnString: string; sourceTable: string; }

export function createConnectorService(ctx: ModuleContext) {
  async function createConnector(orgId: string, input: ConnectorInput): Promise<string> {
    if (!NAME_RE.test(input.name)) throw new Error('invalid connector name');
    if (!TABLE_RE.test(input.sourceTable)) throw new Error('sourceTable must be schema.table');
    if (!input.sourceConnString) throw new Error('sourceConnString required');
    const id = randomUUID();
    await ctx.db.query(
      `INSERT INTO db_connectors(id,org_id,name,source_conn_string,source_table) VALUES ($1,$2,$3,$4,$5)`,
      [id, orgId, input.name, input.sourceConnString, input.sourceTable],
    );
    return id;
  }

  async function listConnectors(orgId: string): Promise<Array<{ id: string; name: string; sourceTable: string }>> {
    const rows = await ctx.db.query<{ id: string; name: string; source_table: string }>(
      `SELECT id, name, source_table FROM db_connectors WHERE org_id = $1 ORDER BY name`, [orgId],
    );
    return rows.map((r) => ({ id: r.id, name: r.name, sourceTable: r.source_table }));
  }

  async function sync(orgId: string, connectorId: string): Promise<{ datasetId: string; rowCount: number }> {
    const c = await ctx.db.query<{ name: string; source_conn_string: string; source_table: string }>(
      `SELECT name, source_conn_string, source_table FROM db_connectors WHERE org_id = $1 AND id = $2`, [orgId, connectorId],
    );
    const conn = c[0];
    if (!conn) throw new Error('connector not found');
    if (!TABLE_RE.test(conn.source_table)) throw new Error('invalid source table');

    const datasetId = randomUUID();
    const objectKey = `${orgId}/datasets/${datasetId}/data.parquet`;
    const s3url = ctx.objectStore.getObjectUrl(objectKey);
    const session = await ctx.query.open();
    try {
      await session.all(`ATTACH '${conn.source_conn_string}' AS src (TYPE postgres, READ_ONLY)`);
      await session.all(`CREATE TEMP TABLE _ingest AS SELECT * FROM src.${conn.source_table}`);
      const described = await session.all(`DESCRIBE _ingest`);
      const counted = await session.all(`SELECT count(*)::int AS n FROM _ingest`);
      await session.all(`COPY _ingest TO '${s3url}' (FORMAT parquet)`);
      const rowCount = Number(counted[0]?.n ?? 0);

      await ctx.db.query(
        `INSERT INTO datasets(id,org_id,name,object_key,row_count) VALUES ($1,$2,$3,$4,$5)`,
        [datasetId, orgId, conn.name, objectKey, rowCount],
      );
      for (let i = 0; i < described.length; i++) {
        const col = described[i]!;
        await ctx.db.query(
          `INSERT INTO dataset_columns(dataset_id,ordinal,name,duck_type) VALUES ($1,$2,$3,$4)`,
          [datasetId, i, String(col.column_name), String(col.column_type)],
        );
      }
      return { datasetId, rowCount };
    } finally {
      await session.close();
    }
  }

  return { createConnector, listConnectors, sync };
}
