import { describe, it, expect, beforeAll } from 'vitest';
import { openDuckDb } from '../src/duckdb.js';
import { writeFlightsParquet } from './fixtures.js';

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
