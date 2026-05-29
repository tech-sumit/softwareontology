import type { ObjectTypeMapping, PropType, FilterOp, ResolveOptions } from './types.js';

const DUCK_TYPE: Record<PropType, string> = {
  string: 'VARCHAR',
  // 32-bit INTEGER (not BIGINT): duckdb-async marshals 64-bit BIGINT to a JS
  // BigInt, but a 32-bit INTEGER comes back as a plain JS number. The ontology
  // `int` PropType is a 32-bit integer (use `float`/DOUBLE for wider numerics),
  // so INTEGER is the correct mapping and avoids surprising BigInt results.
  int: 'INTEGER',
  float: 'DOUBLE',
  bool: 'BOOLEAN',
  timestamp: 'TIMESTAMP',
};

const ALLOWED_OPS: Record<FilterOp, string> = {
  '=': '=', '!=': '!=', '>': '>', '<': '<', '>=': '>=', '<=': '<=',
};

/** Trusted-config identifiers only. Guard against SQL injection via config. */
function ident(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Unsafe identifier: ${name}`);
  }
  return name;
}

export function buildResolveSql(
  m: ObjectTypeMapping,
  pgAlias: string,
  opts: ResolveOptions,
): { sql: string; params: unknown[] } {
  const ot = ident(m.objectType);
  const pkProp = m.properties.find((p) => p.name === m.primaryKey);
  if (!pkProp) throw new Error(`primaryKey '${m.primaryKey}' not in properties`);

  const baseRef = `read_parquet('${m.backing.path}')`;

  const baseCols = m.properties
    .map((p) => {
      const col = ident(p.column);
      const prop = ident(p.name);
      const overlay =
        `(SELECT w.value FROM ${pgAlias}.public.object_writeback w ` +
        `WHERE w.object_type = '${ot}' ` +
        `AND w.primary_key = CAST(base."${ident(pkProp.column)}" AS VARCHAR) ` +
        `AND w.property = '${prop}' ORDER BY w.version DESC LIMIT 1)`;
      return `COALESCE(CAST(${overlay} AS ${DUCK_TYPE[p.type]}), base."${col}") AS "${prop}"`;
    })
    .join(',\n    ');

  const createdCols = m.properties
    .map((p) => `CAST(json_extract_string(c.payload, '${ident(p.name)}') AS ${DUCK_TYPE[p.type]}) AS "${ident(p.name)}"`)
    .join(',\n    ');

  const params: unknown[] = [];
  let where = '';
  if (opts.filters?.length) {
    const clauses = opts.filters.map((f) => {
      const op = ALLOWED_OPS[f.op];
      if (!op) throw new Error(`Disallowed operator: ${f.op}`);
      params.push(f.value);
      return `"${ident(f.property)}" ${op} ?`;
    });
    where = `WHERE ${clauses.join(' AND ')}`;
  }

  const limit = Number.isInteger(opts.limit) ? opts.limit : 100;
  const offset = Number.isInteger(opts.offset) ? opts.offset : 0;

  const sql =
`WITH resolved AS (
  SELECT
    ${baseCols}
  FROM ${baseRef} base
  UNION ALL
  SELECT
    ${createdCols}
  FROM ${pgAlias}.public.object_created c
  WHERE c.object_type = '${ot}'
)
SELECT * FROM resolved
${where}
ORDER BY "${ident(m.primaryKey)}"
LIMIT ${limit} OFFSET ${offset}`;

  return { sql, params };
}
