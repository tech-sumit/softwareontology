import { describe, it, expect } from 'vitest';
import { defineModule } from '../src/define-module.js';
import { createFakeContext, bootModuleForTest } from '../src/testing.js';

describe('createFakeContext', () => {
  it('provides a working in-memory event bus', () => {
    const ctx = createFakeContext();
    const seen: string[] = [];
    ctx.events.on<string>('ping', (p) => { seen.push(p); });
    ctx.events.emit('ping', 'hello');
    expect(seen).toEqual(['hello']);
  });
});

describe('bootModuleForTest', () => {
  it('runs onInstall then onStart with the fake ctx', async () => {
    const calls: string[] = [];
    const mod = defineModule({
      id: 'demo',
      onInstall() { calls.push('install'); },
      onStart() { calls.push('start'); },
    });
    await bootModuleForTest(mod);
    expect(calls).toEqual(['install', 'start']);
  });
});
