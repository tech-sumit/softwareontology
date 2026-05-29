import { Database } from 'duckdb-async';
import type { S3Options } from './types.js';

export type DuckDb = Database;

/** Opens an in-process DuckDB session with json + postgres + httpfs loaded. */
export async function openDuckDb(): Promise<DuckDb> {
  const db = await Database.create(':memory:');
  for (const ext of ['json', 'postgres', 'httpfs']) {
    await db.all(`INSTALL ${ext}`);
    await db.all(`LOAD ${ext}`);
  }
  return db;
}

/** ATTACH a Postgres database read-only under the given alias. */
export async function attachPostgres(db: DuckDb, connString: string, alias = 'pg'): Promise<void> {
  await db.all(`ATTACH '${connString}' AS ${alias} (TYPE postgres, READ_ONLY)`);
}

/** Configure S3 (MinIO) credentials so read_parquet('s3://...') works. */
export async function configureS3(db: DuckDb, s3: S3Options): Promise<void> {
  await db.all(`SET s3_endpoint='${s3.endpoint}'`);
  await db.all(`SET s3_access_key_id='${s3.accessKeyId}'`);
  await db.all(`SET s3_secret_access_key='${s3.secretAccessKey}'`);
  await db.all(`SET s3_region='${s3.region ?? 'us-east-1'}'`);
  await db.all(`SET s3_url_style='path'`);
  await db.all(`SET s3_use_ssl=${s3.useSsl ?? false}`);
}
