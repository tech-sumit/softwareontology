import { describe, it, expect } from 'vitest';
import { createEventBus } from '../src/event-bus.js';

describe('createEventBus', () => {
  it('delivers emitted events to subscribers', () => {
    const bus = createEventBus();
    const seen: number[] = [];
    bus.on<number>('n', (p) => { seen.push(p); });
    bus.emit('n', 1);
    bus.emit('n', 2);
    expect(seen).toEqual([1, 2]);
  });

  it('unsubscribes via the returned function', () => {
    const bus = createEventBus();
    const seen: number[] = [];
    const off = bus.on<number>('n', (p) => { seen.push(p); });
    bus.emit('n', 1);
    off();
    bus.emit('n', 2);
    expect(seen).toEqual([1]);
  });
});
