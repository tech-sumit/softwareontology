import { Database } from 'duckdb-async';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
