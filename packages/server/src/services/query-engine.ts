import { openDuckDb, attachPostgres, configureS3 } from '@so/query';
import type { QueryEngine, Config } from '@so/sdk';

export function createQueryEngine(config: Config): QueryEngine {
  return {
    async open() {
      const db = await openDuckDb();
      await attachPostgres(db, config.require('DATABASE_URL'), 'pg');
      await configureS3(db, {
        endpoint: config.require('S3_ENDPOINT'),
        accessKeyId: config.require('S3_ACCESS_KEY_ID'),
        secretAccessKey: config.require('S3_SECRET_ACCESS_KEY'),
        region: config.get('S3_REGION') ?? 'us-east-1',
        useSsl: config.get('S3_USE_SSL') === 'true',
      });
      return {
        all: (sql: string, ...params: unknown[]) =>
          db.all(sql, ...params) as Promise<Record<string, unknown>[]>,
        close: () => db.close(),
      };
    },
  };
}
