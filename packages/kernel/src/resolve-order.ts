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
