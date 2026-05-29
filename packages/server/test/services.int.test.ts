import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createConfig } from '../src/config.js';
import { createDb, type DbService } from '../src/services/db.js';
import { createObjectStore } from '../src/services/object-store.js';
import { createQueryEngine } from '../src/services/query-engine.js';

const config = createConfig({
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so',
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'localhost:9000',
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin',
  S3_BUCKET: process.env.S3_BUCKET ?? 'so-datasets',
});

let db: DbService;
beforeAll(() => { db = createDb(config); });
afterAll(async () => { await db.close(); });

describe('service factories', () => {
  it('db runs a query', async () => {
    const rows = await db.query<{ n: number }>('SELECT 1::int AS n');
    expect(rows[0]?.n).toBe(1);
  });

  it('object store reaches the bucket and builds s3 urls', async () => {
    const os = createObjectStore(config);
    await os.ping(); // throws if bucket unreachable
    expect(os.getObjectUrl('a/b.parquet')).toBe('s3://so-datasets/a/b.parquet');
  });

  it('query engine opens a session with postgres attached', async () => {
    const qe = createQueryEngine(config);
    const session = await qe.open();
    try {
      const rows = await session.all("SELECT count(*)::int AS n FROM pg.public.object_writeback");
      expect(typeof rows[0]?.n).toBe('number');
    } finally {
      await session.close();
    }
  });
});

describe('db.transaction', () => {
  it('commits successful work', async () => {
    const rows = await db.transaction(async (tx) => tx.query<{ n: number }>('SELECT 7::int AS n'));
    expect(rows[0]?.n).toBe(7);
  });

  it('rolls back and rethrows on error', async () => {
    await expect(db.transaction(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
  });
});
