import type {
  ModuleContext, ModuleDefinition, EventBus, EventHandler,
  Logger, Config, Registry, ContributionSlot,
} from './types.js';

/** Build a ModuleContext backed by in-memory fakes, for isolated module tests. */
export function createFakeContext(overrides: Partial<ModuleContext> = {}): ModuleContext {
  const handlers = new Map<string, Set<EventHandler>>();
  const events: EventBus = {
    emit(event, payload) {
      for (const h of handlers.get(event) ?? []) void h(payload);
    },
    on(event, handler) {
      let set = handlers.get(event);
      if (!set) { set = new Set(); handlers.set(event, set); }
      set.add(handler as EventHandler);
      return () => set.delete(handler as EventHandler);
    },
  };

  const log: Logger = {
    debug() {}, info() {}, warn() {}, error() {},
    child: () => log,
  };

  const store = new Map<ContributionSlot, unknown[]>();
  const registry: Registry = {
    get<T>(slot: ContributionSlot): T[] { return (store.get(slot) ?? []) as T[]; },
  };

  const config: Config = {
    get() { return undefined; },
    require(key) { throw new Error(`missing config: ${key}`); },
  };

  const base: ModuleContext = {
    db: { query: async () => [] },
    objectStore: { putObject: async () => {}, getObjectUrl: (k) => `mem://${k}` },
    query: { open: async () => { throw new Error('query engine unavailable in fake ctx'); } },
    registry, events, config, log,
  };
  return { ...base, ...overrides };
}

/** Boot a module in isolation: run onInstall then onStart against a fake ctx. */
export async function bootModuleForTest(
  def: ModuleDefinition,
  ctx: ModuleContext = createFakeContext(),
): Promise<ModuleContext> {
  await def.onInstall?.(ctx);
  await def.onStart?.(ctx);
  return ctx;
}
