import type { Config } from '@so/sdk';

export function createConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    get: (key) => env[key],
    require: (key) => {
      const v = env[key];
      if (v === undefined || v === '') throw new Error(`Missing required config: ${key}`);
      return v;
    },
  };
}
