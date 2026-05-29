import { describe, it, expect, beforeAll } from 'vitest';
import { openDuckDb } from '../src/duckdb.js';
import { writeFlightsParquet } from './fixtures.js';
import { resolveObjectSet } from '../src/resolver.js';
import type { ObjectTypeMapping } from '../src/types.js';
import { uploadFixtureToS3, TEST_S3 } from './fixtures.js';

let parquetPath: string;
beforeAll(async () => { parquetPath = await writeFlightsParquet(); });

describe('duckdb session', () => {
  it('reads a local parquet file', async () => {
    const db = await openDuckDb();
    try {
      const rows = await db.all(`SELECT count(*)::int AS n FROM read_parquet('${parquetPath}')`);
      expect(rows[0]).toEqual({ n: 3 });
    } finally {
      await db.close();
    }
  });
});

const PG = process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so';

function flightMapping(path: string): ObjectTypeMapping {
  return {
    objectType: 'Flight',
    primaryKey: 'flightNumber',
    properties: [
      { name: 'flightNumber', column: 'flight_no', type: 'string' },
      { name: 'status', column: 'status', type: 'string' },
      { name: 'departureAt', column: 'dep_ts', type: 'timestamp' },
      { name: 'seats', column: 'seats', type: 'int' },
    ],
    backing: { kind: 'localFile', path },
  };
}

describe('resolveObjectSet (local backing + overlay)', () => {
  it('overlay edit overrides the base value', async () => {
    const rows = await resolveObjectSet({
      mapping: flightMapping(parquetPath),
      pgConnString: PG,
      options: { filters: [{ property: 'flightNumber', op: '=', value: 'FL-204' }] },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('Delayed'); // base was 'On time'
  });

  it('created object appears in the result set', async () => {
    const rows = await resolveObjectSet({ mapping: flightMapping(parquetPath), pgConnString: PG });
    const ids = rows.map((r) => r.flightNumber).sort();
    expect(ids).toEqual(['FL-118', 'FL-204', 'FL-552', 'FL-900']); // 3 base + 1 created
    expect(rows.find((r) => r.flightNumber === 'FL-900')?.status).toBe('Scheduled');
  });

  it('unedited base rows pass through unchanged', async () => {
    const rows = await resolveObjectSet({
      mapping: flightMapping(parquetPath),
      pgConnString: PG,
      options: { filters: [{ property: 'flightNumber', op: '=', value: 'FL-552' }] },
    });
    expect(rows[0]?.status).toBe('On time');
    expect(rows[0]?.seats).toBe(200);
  });
});

describe('resolveObjectSet (S3 backing)', () => {
  it('resolves from MinIO and still applies the overlay', async () => {
    const s3Uri = await uploadFixtureToS3(parquetPath);
    const mapping = flightMapping(parquetPath);
    mapping.backing = { kind: 's3', path: s3Uri };

    const rows = await resolveObjectSet({
      mapping,
      pgConnString: PG,
      s3: TEST_S3,
      options: { filters: [{ property: 'flightNumber', op: '=', value: 'FL-204' }] },
    });
    expect(rows[0]?.status).toBe('Delayed');
  });
});
