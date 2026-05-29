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
