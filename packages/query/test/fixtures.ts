import { Database } from 'duckdb-async';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDuckDb, configureS3 } from '../src/index.js';
import type { S3Options } from '../src/index.js';

/** Writes a small flights Parquet fixture and returns its absolute path. */
export async function writeFlightsParquet(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'so-fixture-'));
  const path = join(dir, 'flights.parquet');
  const db = await Database.create(':memory:');
  try {
    await db.all(`
      COPY (
        SELECT * FROM (VALUES
          ('FL-204', 'On time',  TIMESTAMP '2026-05-29 09:40:00', 189),
          ('FL-118', 'Boarding', TIMESTAMP '2026-05-29 10:15:00', 142),
          ('FL-552', 'On time',  TIMESTAMP '2026-05-29 10:50:00', 200)
        ) AS t(flight_no, status, dep_ts, seats)
      ) TO '${path}' (FORMAT parquet);
    `);
  } finally {
    await db.close();
  }
  return path;
}

export const TEST_S3: S3Options = {
  endpoint: process.env.S3_ENDPOINT ?? 'localhost:9000',
  accessKeyId: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin',
  region: 'us-east-1',
  useSsl: false,
};

/** Copies a local parquet fixture into MinIO and returns its s3:// URI. */
export async function uploadFixtureToS3(localPath: string): Promise<string> {
  const bucket = process.env.S3_BUCKET ?? 'so-datasets';
  const uri = `s3://${bucket}/flights.parquet`;
  const db = await openDuckDb();
  try {
    await configureS3(db, TEST_S3);
    await db.all(`COPY (SELECT * FROM read_parquet('${localPath}')) TO '${uri}' (FORMAT parquet)`);
  } finally {
    await db.close();
  }
  return uri;
}
