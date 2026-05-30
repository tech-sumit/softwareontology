import { describe, it, expect } from 'vitest';
import { createClient } from '../src/index.js';

describe('@so/client', () => {
  it('constructs a typed client with GET/POST methods', () => {
    const client = createClient({ baseUrl: 'http://localhost:3000/api' });
    expect(typeof client.GET).toBe('function');
    expect(typeof client.POST).toBe('function');
  });
});
