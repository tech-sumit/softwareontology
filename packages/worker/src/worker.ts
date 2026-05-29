import PgBoss from 'pg-boss';
import type { ModuleDefinition, ModuleContext, Config, Logger, JobDefinition } from '@so/sdk';
import { createKernel } from '@so/kernel';
import { createDb, createObjectStore, createQueryEngine } from '@so/server';

export interface Worker {
  start(): Promise<void>;
  enqueue(name: string, data: unknown): Promise<void>;
  stop(): Promise<void>;
}

export async function createWorker(opts: {
  modules: ModuleDefinition[];
  logger: Logger;
  config: Config;
}): Promise<Worker> {
  const { config, logger } = opts;
  const db = createDb(config);
  const objectStore = createObjectStore(config);
  const query = createQueryEngine(config);

  const kernel = createKernel({
    modules: opts.modules,
    services: { db, objectStore, query, config, log: logger },
  });
  const ctx: ModuleContext = kernel.ctx;

  const boss = new PgBoss(config.require('DATABASE_URL'));

  return {
    async start() {
      await kernel.start();
      await boss.start();
      const jobs = kernel.registry.get<JobDefinition>('jobs');
      for (const job of jobs) {
        // pg-boss v10 createQueue is idempotent (ON CONFLICT DO NOTHING), but
        // guard the "already exists" race so re-runs against an existing schema
        // stay clean.
        try {
          await boss.createQueue(job.name);
        } catch (err) {
          if (!(err instanceof Error) || !err.message.includes('already exists')) throw err;
        }
        await boss.work(job.name, async (batch) => {
          for (const item of batch) await job.handler(ctx, item.data);
        });
        logger.info('job bound', { name: job.name });
      }
    },
    async enqueue(name, data) {
      await boss.send(name, data as object);
    },
    async stop() {
      await boss.stop({ graceful: false });
      await kernel.stop();
      await db.close();
    },
  };
}
