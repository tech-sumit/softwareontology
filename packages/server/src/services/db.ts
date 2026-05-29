import { Pool, type PoolClient } from 'pg';
import type { Db, Config } from '@so/sdk';

export interface DbService extends Db {
  pool: Pool;
  close(): Promise<void>;
}

function clientDb(client: PoolClient): Db {
  const db: Db = {
    async query<R = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<R[]> {
      const res = await client.query(sql, params as unknown[] | undefined);
      return res.rows as R[];
    },
    transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      return fn(db); // nested transaction joins the current one
    },
  };
  return db;
}

export function createDb(config: Config): DbService {
  const pool = new Pool({ connectionString: config.require('DATABASE_URL') });
  return {
    pool,
    async query<R = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<R[]> {
      const res = await pool.query(sql, params as unknown[] | undefined);
      return res.rows as R[];
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(clientDb(client));
        await client.query('COMMIT');
        return result;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}
