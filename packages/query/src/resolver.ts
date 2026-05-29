import { openDuckDb, attachPostgres, configureS3 } from './duckdb.js';
import { buildResolveSql } from './sql.js';
import type { ObjectTypeMapping, ResolveOptions, S3Options } from './types.js';

export interface ResolveArgs {
  mapping: ObjectTypeMapping;
  pgConnString: string;
  s3?: S3Options;
  options?: ResolveOptions;
}

/** Resolve an object set: base Parquet merged with the Postgres write-back overlay. */
export async function resolveObjectSet(args: ResolveArgs): Promise<Record<string, unknown>[]> {
  const db = await openDuckDb();
  try {
    await attachPostgres(db, args.pgConnString, 'pg');
    if (args.s3) await configureS3(db, args.s3);
    const { sql, params } = buildResolveSql(args.mapping, 'pg', args.options ?? {});
    return (await db.all(sql, ...params)) as Record<string, unknown>[];
  } finally {
    await db.close();
  }
}
