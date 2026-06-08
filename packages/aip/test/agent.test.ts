import { describe, it, expect } from 'vitest';
import { parseAction } from '../src/agent.js';
describe('parseAction', () => {
  it('parses a tool call embedded in prose', () => {
    expect(parseAction('Sure. {"tool":"search","args":{"objectType":"Flight","query":"x"}} ok'))
      .toEqual({ tool: 'search', args: { objectType: 'Flight', query: 'x' } });
  });
  it('parses a final answer', () => { expect(parseAction('{"final":"done"}')).toEqual({ final: 'done' }); });
  it('returns null when there is no JSON action (echo)', () => {
    expect(parseAction('echo: you are an agent…')).toBeNull();
    expect(parseAction('no braces here')).toBeNull();
  });
});
