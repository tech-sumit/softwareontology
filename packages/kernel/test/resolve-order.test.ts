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
