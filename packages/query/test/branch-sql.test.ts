import { describe, it, expect } from 'vitest';
import { buildResolveSql } from '../src/sql.js';
import type { ObjectTypeMapping } from '../src/types.js';
const M: ObjectTypeMapping = {
  objectType: 'Flight', primaryKey: 'flightNumber',
  properties: [{ name: 'flightNumber', column: 'flight_no', type: 'string' }, { name: 'status', column: 'status', type: 'string' }],
  backing: { kind: 's3', path: 's3://b/f.parquet' },
};
describe('buildResolveSql branch filtering', () => {
  it("defaults to the 'main' branch", () => {
    const { sql } = buildResolveSql(M, 'pg', {});
    expect(sql).toContain("w.branch = 'main'");
    expect(sql).toContain("c.branch = 'main'");
  });
  it('scopes the overlay to a named branch', () => {
    const { sql } = buildResolveSql(M, 'pg', { branch: 'feature-x' });
    expect(sql).toContain("w.branch = 'feature-x'");
    expect(sql).toContain("c.branch = 'feature-x'");
  });
  it('rejects an unsafe branch name', () => {
    expect(() => buildResolveSql(M, 'pg', { branch: "x'; DROP TABLE--" })).toThrow(/invalid branch/);
  });
});
