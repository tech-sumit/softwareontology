// ---- Cross-cutting services (real impls provided by @so/server in Plan 3) ----

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

export type EventHandler<T = unknown> = (payload: T) => void | Promise<void>;

export interface EventBus {
  emit<T = unknown>(event: string, payload: T): void;
  /** Returns an unsubscribe function. */
  on<T = unknown>(event: string, handler: EventHandler<T>): () => void;
}

export interface Config {
  get(key: string): string | undefined;
  require(key: string): string;
}

/** Minimal infra interfaces — refined by the modules that own them in later plans. */
export interface Db {
  query<R = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<R[]>;
  /** Run fn inside a single-connection transaction (BEGIN/COMMIT, ROLLBACK on throw). */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
}
export interface ObjectStore {
  putObject(key: string, body: Uint8Array): Promise<void>;
  getObjectUrl(key: string): string;
}
export interface QueryEngine {
  open(): Promise<{
    all(sql: string, ...params: unknown[]): Promise<Record<string, unknown>[]>;
    close(): Promise<void>;
  }>;
}

// ---- Extension points ----

export type ContributionSlot =
  | 'objectTypes' | 'linkTypes' | 'actions' | 'functions'
  | 'connectors' | 'jobs' | 'permissions' | 'schedules' | 'datasetAccessPolicies' | 'datasetDerivationHooks';

export interface Registry {
  get<T = unknown>(slot: ContributionSlot): T[];
}

export type JobHandler = (ctx: ModuleContext, payload: unknown) => Promise<void> | void;
export interface JobDefinition { name: string; handler: JobHandler; }
export interface ScheduleDefinition { name: string; cron: string; }
export interface DatasetAccessPolicy { check(ctx: ModuleContext, userId: string, datasetId: string): Promise<boolean>; }
export interface DatasetDerivationHook { onDerive(ctx: ModuleContext, outputDatasetId: string, inputDatasetIds: string[]): Promise<void>; }

export interface Contributions {
  objectTypes?: unknown[];   // typed by @so/ontology (Plan 6)
  linkTypes?: unknown[];     // typed by @so/ontology (Plan 6)
  actions?: unknown[];       // typed by @so/actions (Plan 7)
  functions?: unknown[];
  connectors?: unknown[];    // typed by @so/datasets (Plan 5)
  jobs?: JobDefinition[];
  schedules?: ScheduleDefinition[];
  datasetAccessPolicies?: DatasetAccessPolicy[];
  datasetDerivationHooks?: DatasetDerivationHook[];
  permissions?: string[];
  apiRoutes?: unknown;       // Fastify plugin — typed by @so/server (Plan 3)
  ui?: unknown;              // React manifest — typed by @so/ui-shell (Plan 8)
  migrations?: string;       // path to a migrations directory
}

// ---- Module contract ----

export interface ModuleContext {
  db: Db;
  objectStore: ObjectStore;
  query: QueryEngine;
  registry: Registry;
  events: EventBus;
  config: Config;
  log: Logger;
}

export interface ModuleDefinition {
  id: string;
  version?: string;
  dependsOn?: string[];
  contributes?: Contributions;
  onInstall?(ctx: ModuleContext): Promise<void> | void;
  onStart?(ctx: ModuleContext): Promise<void> | void;
  onStop?(ctx: ModuleContext): Promise<void> | void;
}
