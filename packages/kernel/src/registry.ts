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
