import { describe, it, expect } from 'vitest';
import { hashEmbed, cosine, EMBED_DIM } from '../src/embed.js';
describe('embeddings', () => {
  it('produces normalized vectors of fixed length', () => {
    const v = hashEmbed('hello world');
    expect(v).toHaveLength(EMBED_DIM);
    expect(Math.abs(Math.sqrt(v.reduce((s, x) => s + x * x, 0)) - 1)).toBeLessThan(1e-9);
  });
  it('ranks semantically closer text higher', () => {
    const q = hashEmbed('delayed flight to boston');
    const near = hashEmbed('the flight to boston was delayed');
    const far = hashEmbed('quarterly revenue spreadsheet totals');
    expect(cosine(q, near)).toBeGreaterThan(cosine(q, far));
  });
});
