export type PropType = 'string' | 'int' | 'float' | 'bool' | 'timestamp';

export interface PropertyMapping {
  /** Ontology property name, e.g. "flightNumber" */
  name: string;
  /** Backing dataset column, e.g. "flight_no" */
  column: string;
  type: PropType;
}

export interface ObjectTypeMapping {
  /** Object type id, e.g. "Flight" */
  objectType: string;
  /** Name of the property that is the primary key (must exist in `properties`) */
  primaryKey: string;
  properties: PropertyMapping[];
  backing: { kind: 'localFile' | 's3'; path: string };
}

export type FilterOp = '=' | '!=' | '>' | '<' | '>=' | '<=';

export interface Filter {
  property: string;
  op: FilterOp;
  value: string | number | boolean;
}

export interface ResolveOptions {
  filters?: Filter[];
  limit?: number;
  offset?: number;
}

export interface S3Options {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  useSsl?: boolean;
}
