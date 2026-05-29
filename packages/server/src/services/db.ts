import { Pool } from 'pg';
import type { Db, Config } from '@so/sdk';

export interface DbService extends Db {
  pool: Pool;
  close(): Promise<void>;
}

export function createDb(config: Config): DbService {
  const pool = new Pool({ connectionString: config.require('DATABASE_URL') });
  return {
    pool,
    async query<R = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<R[]> {
      const res = await pool.query(sql, params as unknown[] | undefined);
      return res.rows as R[];
    },
    async close() { await pool.end(); },
  };
}
