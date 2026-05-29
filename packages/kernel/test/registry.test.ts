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
