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
