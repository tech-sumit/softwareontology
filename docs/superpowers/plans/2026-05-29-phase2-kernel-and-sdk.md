# Phase 2 — Kernel & SDK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the module framework — `@so/sdk` (the `defineModule` contract, shared types, and a contract-test harness) and `@so/kernel` (module discovery, dependency-ordered loading, the service container `ctx`, an event bus, and extension-point registries) — so every later capability plugs in as a module.

**Architecture:** `@so/sdk` defines interfaces only (no infra). `@so/kernel` depends on `@so/sdk` and provides concrete in-memory implementations (registry, event bus) plus `createKernel({ modules, services })` which topologically sorts modules by `dependsOn`, builds `ctx` from injected services, registers each module's contributions, and runs `onInstall`/`onStart`/`onStop` lifecycle hooks. The kernel needs NO real database — infra services (`db`, `objectStore`, `query`) are *injected*, so the whole framework is unit-testable with fakes. Real services arrive in Plan 3 (`@so/server`).

**Tech Stack:** TypeScript 5 (strict, ESM/NodeNext), Vitest, pnpm workspaces. `@so/kernel` consumes `@so/sdk` via `workspace:*` using the source-exports pattern already used by `@so/query`.

---

## Pre-flight

- [ ] **Create the feature branch from main:**

```bash
cd /Users/sumitagrawal/CODE/sumit/SoftwareOntology
git checkout main && git checkout -b phase2/kernel-and-sdk
```

---

## File structure (created by this plan)

```
packages/sdk/
  package.json                 @so/sdk (no runtime deps)
  tsconfig.json
  src/types.ts                 Logger, EventBus, Config, Db, ObjectStore, QueryEngine,
                               Registry, Contributions, ModuleContext, ModuleDefinition
  src/define-module.ts         defineModule() identity + id validation
  src/testing.ts               createFakeContext(), bootModuleForTest()
  src/index.ts                 public exports
  test/define-module.test.ts
  test/testing.test.ts
packages/kernel/
  package.json                 @so/kernel (dep: @so/sdk workspace:*)
  tsconfig.json
  src/event-bus.ts             createEventBus() — in-memory pub/sub
  src/registry.ts              createRegistry() — extension-point store
  src/resolve-order.ts         resolveLoadOrder() — pure topological sort
  src/kernel.ts                createKernel() — orchestration
  src/index.ts                 public exports
  test/event-bus.test.ts
  test/registry.test.ts
  test/resolve-order.test.ts
  test/kernel.test.ts
vitest.config.ts               root config (replaces deprecated vitest.workspace.ts)
```

Responsibilities are split so each file is independently testable: `resolve-order` is pure (no I/O), `event-bus`/`registry` are tiny state holders, `kernel` is pure orchestration over injected services.

---

## Task 1: `@so/sdk` — types + `defineModule`

**Files:**
- Create: `packages/sdk/package.json`, `packages/sdk/tsconfig.json`, `packages/sdk/src/types.ts`, `packages/sdk/src/define-module.ts`, `packages/sdk/src/index.ts`, `packages/sdk/test/define-module.test.ts`

- [ ] **Step 1: Create `packages/sdk/package.json`**

```json
{
  "name": "@so/sdk",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  }
}
```

- [ ] **Step 2: Run `pnpm install`** (registers the new workspace package)

Run: `pnpm install`
Expected: completes; `@so/sdk` linked into the workspace.

- [ ] **Step 3: Create `packages/sdk/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist" },
  "include": ["src/**/*", "test/**/*"]
}
```

- [ ] **Step 4: Create `packages/sdk/src/types.ts`**

```ts
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
  | 'connectors' | 'jobs' | 'permissions';

export interface Registry {
  get<T = unknown>(slot: ContributionSlot): T[];
}

export type JobHandler = (ctx: ModuleContext, payload: unknown) => Promise<void> | void;
export interface JobDefinition { name: string; handler: JobHandler; }

export interface Contributions {
  objectTypes?: unknown[];   // typed by @so/ontology (Plan 6)
  linkTypes?: unknown[];     // typed by @so/ontology (Plan 6)
  actions?: unknown[];       // typed by @so/actions (Plan 7)
  functions?: unknown[];
  connectors?: unknown[];    // typed by @so/datasets (Plan 5)
  jobs?: JobDefinition[];
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
```

- [ ] **Step 5: Create `packages/sdk/src/define-module.ts`**

```ts
import type { ModuleDefinition } from './types.js';

const ID_RE = /^[a-z][a-z0-9-]*$/;

/** Identity helper that validates a module definition and preserves its type. */
export function defineModule(def: ModuleDefinition): ModuleDefinition {
  if (!ID_RE.test(def.id)) {
    throw new Error(`Invalid module id "${def.id}": must match ${ID_RE.source}`);
  }
  return def;
}
```

- [ ] **Step 6: Create `packages/sdk/src/index.ts`**

```ts
export * from './types.js';
export { defineModule } from './define-module.js';
```

- [ ] **Step 7: Create `packages/sdk/test/define-module.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { defineModule } from '../src/define-module.js';

describe('defineModule', () => {
  it('returns the definition unchanged for a valid id', () => {
    const def = defineModule({ id: 'ontology', dependsOn: ['datasets'] });
    expect(def.id).toBe('ontology');
    expect(def.dependsOn).toEqual(['datasets']);
  });

  it('throws on an invalid id', () => {
    expect(() => defineModule({ id: 'Ontology' })).toThrow(/Invalid module id/);
    expect(() => defineModule({ id: '1bad' })).toThrow(/Invalid module id/);
  });
});
```

- [ ] **Step 8: Run the tests**

Run: `pnpm --filter @so/sdk test`
Expected: PASS (2 tests).

- [ ] **Step 9: Typecheck + commit**

Run: `pnpm --filter @so/sdk run typecheck` (expect clean)

```bash
git add -A
git commit -m "feat(sdk): @so/sdk module contract — types + defineModule"
```

---

## Task 2: `@so/sdk` — contract-test harness

**Files:**
- Create: `packages/sdk/src/testing.ts`, `packages/sdk/test/testing.test.ts`
- Modify: `packages/sdk/src/index.ts`

- [ ] **Step 1: Write the failing test — `packages/sdk/test/testing.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { defineModule } from '../src/define-module.js';
import { createFakeContext, bootModuleForTest } from '../src/testing.js';

describe('createFakeContext', () => {
  it('provides a working in-memory event bus', () => {
    const ctx = createFakeContext();
    const seen: string[] = [];
    ctx.events.on<string>('ping', (p) => seen.push(p));
    ctx.events.emit('ping', 'hello');
    expect(seen).toEqual(['hello']);
  });
});

describe('bootModuleForTest', () => {
  it('runs onInstall then onStart with the fake ctx', async () => {
    const calls: string[] = [];
    const mod = defineModule({
      id: 'demo',
      onInstall() { calls.push('install'); },
      onStart() { calls.push('start'); },
    });
    await bootModuleForTest(mod);
    expect(calls).toEqual(['install', 'start']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @so/sdk test testing`
Expected: FAIL — `Cannot find module '../src/testing.js'`.

- [ ] **Step 3: Create `packages/sdk/src/testing.ts`**

```ts
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
```

- [ ] **Step 4: Export it — modify `packages/sdk/src/index.ts`**

Add:
```ts
export { createFakeContext, bootModuleForTest } from './testing.js';
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @so/sdk test`
Expected: PASS (4 tests total).

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm --filter @so/sdk run typecheck` (expect clean)

```bash
git add -A
git commit -m "feat(sdk): contract-test harness (createFakeContext, bootModuleForTest)"
```

---

## Task 3: `@so/kernel` — event bus + registry

**Files:**
- Create: `packages/kernel/package.json`, `packages/kernel/tsconfig.json`, `packages/kernel/src/event-bus.ts`, `packages/kernel/src/registry.ts`, `packages/kernel/src/index.ts`, `packages/kernel/test/event-bus.test.ts`, `packages/kernel/test/registry.test.ts`

- [ ] **Step 1: Create `packages/kernel/package.json`**

```json
{
  "name": "@so/kernel",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@so/sdk": "workspace:*"
  }
}
```

- [ ] **Step 2: Run `pnpm install`** (links `@so/sdk` into `@so/kernel`)

Run: `pnpm install`
Expected: completes; `node_modules/@so/kernel/node_modules/@so/sdk` (or hoisted) symlink present.

- [ ] **Step 3: Create `packages/kernel/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "types": ["node"] },
  "include": ["src/**/*", "test/**/*"]
}
```

- [ ] **Step 4: Write failing tests — `packages/kernel/test/event-bus.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { createEventBus } from '../src/event-bus.js';

describe('createEventBus', () => {
  it('delivers emitted events to subscribers', () => {
    const bus = createEventBus();
    const seen: number[] = [];
    bus.on<number>('n', (p) => seen.push(p));
    bus.emit('n', 1);
    bus.emit('n', 2);
    expect(seen).toEqual([1, 2]);
  });

  it('unsubscribes via the returned function', () => {
    const bus = createEventBus();
    const seen: number[] = [];
    const off = bus.on<number>('n', (p) => seen.push(p));
    bus.emit('n', 1);
    off();
    bus.emit('n', 2);
    expect(seen).toEqual([1]);
  });
});
```

and `packages/kernel/test/registry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createRegistry } from '../src/registry.js';

describe('createRegistry', () => {
  it('accumulates contributions from multiple modules under a slot', () => {
    const reg = createRegistry();
    reg.register('permissions', ['a:read']);
    reg.register('permissions', ['b:edit']);
    expect(reg.get<string>('permissions')).toEqual(['a:read', 'b:edit']);
  });

  it('returns an empty array for an unused slot', () => {
    const reg = createRegistry();
    expect(reg.get('actions')).toEqual([]);
  });
});
```

- [ ] **Step 5: Run to verify they fail**

Run: `pnpm --filter @so/kernel test`
Expected: FAIL — missing `../src/event-bus.js` / `../src/registry.js`.

- [ ] **Step 6: Create `packages/kernel/src/event-bus.ts`**

```ts
import type { EventBus, EventHandler } from '@so/sdk';

export function createEventBus(): EventBus {
  const handlers = new Map<string, Set<EventHandler>>();
  return {
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
}
```

- [ ] **Step 7: Create `packages/kernel/src/registry.ts`**

```ts
import type { Registry, ContributionSlot } from '@so/sdk';

export interface MutableRegistry extends Registry {
  register(slot: ContributionSlot, items: unknown[]): void;
}

export function createRegistry(): MutableRegistry {
  const store = new Map<ContributionSlot, unknown[]>();
  return {
    register(slot, items) {
      const cur = store.get(slot) ?? [];
      cur.push(...items);
      store.set(slot, cur);
    },
    get<T>(slot: ContributionSlot): T[] {
      return (store.get(slot) ?? []) as T[];
    },
  };
}
```

- [ ] **Step 8: Create `packages/kernel/src/index.ts`**

```ts
export { createEventBus } from './event-bus.js';
export { createRegistry, type MutableRegistry } from './registry.js';
```

- [ ] **Step 9: Run to verify they pass**

Run: `pnpm --filter @so/kernel test`
Expected: PASS (4 tests).

- [ ] **Step 10: Typecheck + commit**

Run: `pnpm --filter @so/kernel run typecheck` (expect clean)

```bash
git add -A
git commit -m "feat(kernel): in-memory event bus + extension-point registry"
```

---

## Task 4: `@so/kernel` — dependency resolution (pure)

**Files:**
- Create: `packages/kernel/src/resolve-order.ts`, `packages/kernel/test/resolve-order.test.ts`
- Modify: `packages/kernel/src/index.ts`

- [ ] **Step 1: Write the failing test — `packages/kernel/test/resolve-order.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { defineModule } from '@so/sdk';
import { resolveLoadOrder } from '../src/resolve-order.js';

const m = (id: string, deps: string[] = []) => defineModule({ id, dependsOn: deps });

describe('resolveLoadOrder', () => {
  it('orders linear dependencies', () => {
    expect(resolveLoadOrder([m('c', ['b']), m('b', ['a']), m('a')])).toEqual(['a', 'b', 'c']);
  });

  it('handles diamond dependencies (deps before dependents)', () => {
    const order = resolveLoadOrder([m('d', ['b', 'c']), m('b', ['a']), m('c', ['a']), m('a')]);
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('c'));
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('d'));
    expect(order.indexOf('c')).toBeLessThan(order.indexOf('d'));
  });

  it('throws on a missing dependency', () => {
    expect(() => resolveLoadOrder([m('a', ['ghost'])])).toThrow(/Missing module dependency: ghost/);
  });

  it('throws on a cycle', () => {
    expect(() => resolveLoadOrder([m('a', ['b']), m('b', ['a'])])).toThrow(/cycle/i);
  });

  it('throws on a duplicate id', () => {
    expect(() => resolveLoadOrder([m('a'), m('a')])).toThrow(/Duplicate module id/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @so/kernel test resolve-order`
Expected: FAIL — `Cannot find module '../src/resolve-order.js'`.

- [ ] **Step 3: Create `packages/kernel/src/resolve-order.ts`**

```ts
import type { ModuleDefinition } from '@so/sdk';

/** Topologically sort modules so every dependency precedes its dependents. */
export function resolveLoadOrder(modules: ModuleDefinition[]): string[] {
  const byId = new Map<string, ModuleDefinition>();
  for (const m of modules) {
    if (byId.has(m.id)) throw new Error(`Duplicate module id: ${m.id}`);
    byId.set(m.id, m);
  }

  const order: string[] = [];
  const state = new Map<string, 'visiting' | 'done'>();

  const visit = (id: string, path: string[]): void => {
    const st = state.get(id);
    if (st === 'done') return;
    if (st === 'visiting') throw new Error(`Dependency cycle: ${[...path, id].join(' -> ')}`);

    const mod = byId.get(id);
    if (!mod) throw new Error(`Missing module dependency: ${id}`);

    state.set(id, 'visiting');
    for (const dep of mod.dependsOn ?? []) visit(dep, [...path, id]);
    state.set(id, 'done');
    order.push(id);
  };

  for (const m of modules) visit(m.id, []);
  return order;
}
```

- [ ] **Step 4: Export it — modify `packages/kernel/src/index.ts`**

Add:
```ts
export { resolveLoadOrder } from './resolve-order.js';
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @so/kernel test resolve-order`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(kernel): dependency-ordered module load resolution"
```

---

## Task 5: `@so/kernel` — `createKernel` orchestration

**Files:**
- Create: `packages/kernel/src/kernel.ts`, `packages/kernel/test/kernel.test.ts`
- Modify: `packages/kernel/src/index.ts`

- [ ] **Step 1: Write the failing test — `packages/kernel/test/kernel.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { defineModule, createFakeContext } from '@so/sdk';
import type { Logger } from '@so/sdk';
import { createKernel, type KernelServices } from '../src/kernel.js';

function fakeServices(logs: string[]): KernelServices {
  const ctx = createFakeContext();
  const log: Logger = { debug() {}, info: (m) => logs.push(m), warn() {}, error() {}, child: () => log };
  return { db: ctx.db, objectStore: ctx.objectStore, query: ctx.query, config: ctx.config, log };
}

describe('createKernel', () => {
  it('computes load order and starts modules in it, registering contributions', async () => {
    const started: string[] = [];
    const a = defineModule({ id: 'a', contributes: { permissions: ['a:read'] }, onStart() { started.push('a'); } });
    const b = defineModule({ id: 'b', dependsOn: ['a'], onStart() { started.push('b'); } });
    const c = defineModule({ id: 'c', dependsOn: ['a', 'b'], onStart() { started.push('c'); } });

    const logs: string[] = [];
    const kernel = createKernel({ modules: [c, b, a], services: fakeServices(logs) });
    expect(kernel.order).toEqual(['a', 'b', 'c']);

    await kernel.start();
    expect(started).toEqual(['a', 'b', 'c']);
    expect(kernel.registry.get<string>('permissions')).toEqual(['a:read']);
    expect(logs).toContain('module started: a');
  });

  it('runs onInstall before onStart for each module', async () => {
    const calls: string[] = [];
    const a = defineModule({ id: 'a', onInstall() { calls.push('install:a'); }, onStart() { calls.push('start:a'); } });
    const kernel = createKernel({ modules: [a], services: fakeServices([]) });
    await kernel.start();
    expect(calls).toEqual(['install:a', 'start:a']);
  });

  it('stops modules in reverse order', async () => {
    const stopped: string[] = [];
    const a = defineModule({ id: 'a', onStop() { stopped.push('a'); } });
    const b = defineModule({ id: 'b', dependsOn: ['a'], onStop() { stopped.push('b'); } });
    const kernel = createKernel({ modules: [a, b], services: fakeServices([]) });
    await kernel.start();
    await kernel.stop();
    expect(stopped).toEqual(['b', 'a']);
  });

  it('throws if started twice', async () => {
    const kernel = createKernel({ modules: [defineModule({ id: 'a' })], services: fakeServices([]) });
    await kernel.start();
    await expect(kernel.start()).rejects.toThrow(/already started/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @so/kernel test kernel`
Expected: FAIL — `Cannot find module '../src/kernel.js'`.

- [ ] **Step 3: Create `packages/kernel/src/kernel.ts`**

```ts
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
  'objectTypes', 'linkTypes', 'actions', 'functions', 'connectors', 'jobs', 'permissions',
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
```

- [ ] **Step 4: Export it — modify `packages/kernel/src/index.ts`**

Add:
```ts
export { createKernel, type Kernel, type KernelServices } from './kernel.js';
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @so/kernel test`
Expected: PASS (all kernel tests: event-bus 2, registry 2, resolve-order 5, kernel 4 = 13).

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm --filter @so/kernel run typecheck` (expect clean)

```bash
git add -A
git commit -m "feat(kernel): createKernel — dependency-ordered lifecycle + contribution registration"
```

---

## Task 6: Migrate Vitest workspace → root projects config + full verification

**Files:**
- Create: `vitest.config.ts`
- Delete: `vitest.workspace.ts`

> Vitest 3 deprecated `vitest.workspace.ts` in favor of `test.projects` in a root config. Migrate now so the warning doesn't compound as packages grow.

- [ ] **Step 1: Create root `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*'],
  },
});
```

- [ ] **Step 2: Delete the deprecated workspace file**

Run: `git rm vitest.workspace.ts`

- [ ] **Step 3: Bring infra up (the @so/query integration tests need it) and run the full suite**

Run:
```bash
pnpm run infra:up && pnpm run infra:seed
pnpm typecheck && pnpm lint && pnpm test
```
Expected: typecheck clean; lint clean; **all tests pass with NO deprecation warning** — `@so/query` (7), `@so/sdk` (4), `@so/kernel` (13).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: migrate vitest workspace to root projects config"
```

---

## Done criteria for Plan 2

- `@so/sdk` exports the module contract (`defineModule`, `ModuleDefinition`, `ModuleContext`, `Contributions`, service interfaces) and a contract-test harness.
- `@so/kernel` exports `createKernel`, a registry, an event bus, and dependency resolution — fully unit-tested with fakes, no real infra required.
- A trivial set of modules boots in correct dependency order with contributions registered and lifecycle hooks fired; `stop()` reverses order.
- Full workspace suite green (24 tests) with no Vitest deprecation warning.

Plan 3 (`@so/server` + `@so/worker` + `@so/observability`) provides the real `db`/`objectStore`/`query` service implementations the kernel injects, mounts module `apiRoutes` on Fastify, and runs `jobs` on pg-boss.

---

## Self-review (against the spec)

- **Spec §4 (module framework)** — `defineModule` contract with `id`/`dependsOn`/`contributes`/lifecycle; `ctx` carries `db`/`objectStore`/`query`/`registry`/`events`/`config`/`log`; extension-point registries for the contribution slots. ✓
- **Spec §5 (platform foundation)** — this plan delivers `@so/kernel` + `@so/sdk` (the contract-test harness is the "module-contract tests" foundation). `@so/server`/`@so/worker`/`@so/ui-shell`/`@so/observability` are explicitly Plan 3+. ✓
- **Spec §8 (NFRs: quality engineering)** — strict TS; every unit pure-tested; the harness enables per-module contract tests. ✓
- **Placeholder scan** — no TBD/TODO; complete code in every step. ✓
- **Type consistency** — `ModuleDefinition`/`ModuleContext`/`Registry`/`ContributionSlot`/`EventBus`/`Logger` defined once in `sdk/src/types.ts`; `createKernel`/`createRegistry`/`createEventBus`/`resolveLoadOrder` signatures match all call sites in tests; `ARRAY_SLOTS` ⊆ `ContributionSlot`. ✓
- **Deliberately deferred:** real infra services (Plan 3); install-once tracking (kernel currently runs `onInstall` every `start()` — acceptable until persistence exists); `apiRoutes`/`ui` typed as `unknown` until their host packages exist (Plans 3/8). Flagged, not silent.
```
