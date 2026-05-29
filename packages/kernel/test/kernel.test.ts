import { describe, it, expect } from 'vitest';
import { defineModule, createFakeContext } from '@so/sdk';
import type { Logger } from '@so/sdk';
import { createKernel, type KernelServices } from '../src/kernel.js';

function fakeServices(logs: string[]): KernelServices {
  const ctx = createFakeContext();
  const log: Logger = { debug() {}, info: (m) => logs.push(m), warn() {}, error() {}, child: () => log };
  return { db: ctx.db, objectStore: ctx.objectStore, query: ctx.query, config: ctx.config, log };
}

describe('createKernel', () => {
  it('computes load order and starts modules in it, registering contributions', async () => {
    const started: string[] = [];
    const a = defineModule({ id: 'a', contributes: { permissions: ['a:read'] }, onStart() { started.push('a'); } });
    const b = defineModule({ id: 'b', dependsOn: ['a'], onStart() { started.push('b'); } });
    const c = defineModule({ id: 'c', dependsOn: ['a', 'b'], onStart() { started.push('c'); } });

    const logs: string[] = [];
    const kernel = createKernel({ modules: [c, b, a], services: fakeServices(logs) });
    expect(kernel.order).toEqual(['a', 'b', 'c']);

    await kernel.start();
    expect(started).toEqual(['a', 'b', 'c']);
    expect(kernel.registry.get<string>('permissions')).toEqual(['a:read']);
    expect(logs).toContain('module started: a');
  });

  it('runs onInstall before onStart for each module', async () => {
    const calls: string[] = [];
    const a = defineModule({ id: 'a', onInstall() { calls.push('install:a'); }, onStart() { calls.push('start:a'); } });
    const kernel = createKernel({ modules: [a], services: fakeServices([]) });
    await kernel.start();
    expect(calls).toEqual(['install:a', 'start:a']);
  });

  it('stops modules in reverse order', async () => {
    const stopped: string[] = [];
    const a = defineModule({ id: 'a', onStop() { stopped.push('a'); } });
    const b = defineModule({ id: 'b', dependsOn: ['a'], onStop() { stopped.push('b'); } });
    const kernel = createKernel({ modules: [a, b], services: fakeServices([]) });
    await kernel.start();
    await kernel.stop();
    expect(stopped).toEqual(['b', 'a']);
  });

  it('throws if started twice', async () => {
    const kernel = createKernel({ modules: [defineModule({ id: 'a' })], services: fakeServices([]) });
    await kernel.start();
    await expect(kernel.start()).rejects.toThrow(/already started/);
  });
});
