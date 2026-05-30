import { describe, it, expect } from 'vitest';
import { buildResolveSql } from '../src/sql.js';
import type { ObjectTypeMapping } from '../src/types.js';

const flight: ObjectTypeMapping = {
  objectType: 'Flight',
  primaryKey: 'flightNumber',
  properties: [
    { name: 'flightNumber', column: 'flight_no', type: 'string' },
    { name: 'status', column: 'status', type: 'string' },
    { name: 'departureAt', column: 'dep_ts', type: 'timestamp' },
    { name: 'seats', column: 'seats', type: 'int' },
  ],
  backing: { kind: 'localFile', path: '/tmp/flights.parquet' },
};

describe('buildResolveSql', () => {
  it('merges overlay via COALESCE and unions created objects', () => {
    const { sql, params } = buildResolveSql(flight, 'pg', {});
    expect(sql).toContain(`read_parquet('/tmp/flights.parquet')`);
    expect(sql).toContain('object_writeback');
    expect(sql).toContain('object_created');
    expect(sql).toContain('COALESCE');
    expect(sql).toContain(`AS "status"`);
    expect(sql).toContain('UNION ALL');
    expect(params).toEqual([]);
  });

  it('parameterizes filter values and rejects bad operators', () => {
    const { sql, params } = buildResolveSql(flight, 'pg', {
      filters: [{ property: 'status', op: '=', value: 'Delayed' }],
      limit: 10,
    });
    expect(sql).toContain(`WHERE "status" = ?`);
    expect(sql).toContain('LIMIT 10');
    expect(params).toEqual(['Delayed']);
    expect(() =>
      buildResolveSql(flight, 'pg', { filters: [{ property: 'x', op: 'DROP' as never, value: 1 }] }),
    ).toThrow();
  });
});

describe('buildResolveSql with functions', () => {
  const withFn: ObjectTypeMapping = {
    ...flight,
    functions: [{ name: 'isDelayed', expression: "status = 'Delayed'", type: 'bool' }],
  };
  it('adds a CAST computed column over the resolved CTE', () => {
    const { sql } = buildResolveSql(withFn, 'pg', {});
    expect(sql).toContain('FROM resolved');
    expect(sql).toContain(`CAST((status = 'Delayed') AS BOOLEAN) AS "isDelayed"`);
  });
  it('is byte-identical to no-functions when functions is empty/absent', () => {
    const a = buildResolveSql(flight, 'pg', {}).sql;
    const b = buildResolveSql({ ...flight, functions: [] }, 'pg', {}).sql;
    expect(a).toBe(b);
  });
  it('rejects dangerous expressions', () => {
    expect(() => buildResolveSql({ ...flight, functions: [{ name: 'x', expression: 'status; DROP TABLE users', type: 'string' }] }, 'pg', {})).toThrow();
  });
});
