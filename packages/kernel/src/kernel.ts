import type {
  ModuleDefinition, ModuleContext, ContributionSlot,
  Db, ObjectStore, QueryEngine, Config, Logger,
} from '@so/sdk';
import { createRegistry, type MutableRegistry } from './registry.js';
import { createEventBus } from './event-bus.js';
import { resolveLoadOrder } from './resolve-order.js';

export interface KernelServices {
  db: Db;
  objectStore: ObjectStore;
  query: QueryEngine;
  config: Config;
  log: Logger;
}

export interface Kernel {
  readonly order: string[];
  readonly registry: MutableRegistry;
  readonly ctx: ModuleContext;
  start(): Promise<void>;
  stop(): Promise<void>;
}

const ARRAY_SLOTS: ContributionSlot[] = [
  'objectTypes', 'linkTypes', 'actions', 'functions', 'connectors', 'jobs', 'permissions', 'schedules', 'datasetAccessPolicies',
];

export function createKernel(opts: { modules: ModuleDefinition[]; services: KernelServices }): Kernel {
  const { modules, services } = opts;
  const order = resolveLoadOrder(modules);
  const byId = new Map(modules.map((m) => [m.id, m]));
  const registry = createRegistry();
  const events = createEventBus();

  const ctx: ModuleContext = {
    db: services.db,
    objectStore: services.objectStore,
    query: services.query,
    registry,
    events,
    config: services.config,
    log: services.log,
  };

  let started = false;

  return {
    order,
    registry,
    ctx,
    async start() {
      if (started) throw new Error('Kernel already started');
      for (const id of order) {
        const mod = byId.get(id)!;
        for (const slot of ARRAY_SLOTS) {
          const items = mod.contributes?.[slot];
          if (Array.isArray(items) && items.length > 0) registry.register(slot, items);
        }
        await mod.onInstall?.(ctx);
        await mod.onStart?.(ctx);
        services.log.info(`module started: ${id}`);
      }
      started = true;
    },
    async stop() {
      for (const id of [...order].reverse()) {
        await byId.get(id)?.onStop?.(ctx);
      }
      started = false;
    },
  };
}
