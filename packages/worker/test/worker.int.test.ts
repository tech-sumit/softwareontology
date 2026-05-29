import { describe, it, expect, afterAll } from 'vitest';
import { defineModule } from '@so/sdk';
import { createLogger } from '@so/observability';
import { createConfig } from '@so/server';
import { createWorker, type Worker } from '../src/worker.js';

const config = createConfig({
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://so:so@localhost:5432/so',
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'localhost:9000',
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin',
  S3_BUCKET: process.env.S3_BUCKET ?? 'so-datasets',
});

let worker: Worker;
afterAll(async () => { await worker?.stop(); });

describe('createWorker', () => {
  it('runs a job contributed by a module', async () => {
    let resolveRan: (v: unknown) => void;
    const ran = new Promise((res) => { resolveRan = res; });

    const jobModule = defineModule({
      id: 'jobs-demo',
      contributes: {
        jobs: [{ name: 'demo.echo', handler: (_ctx, payload) => { resolveRan(payload); } }],
      },
    });

    worker = await createWorker({ modules: [jobModule], logger: createLogger(), config });
    await worker.start();
    await worker.enqueue('demo.echo', { hello: 'world' });

    const payload = await ran;
    expect(payload).toEqual({ hello: 'world' });
  });
});
