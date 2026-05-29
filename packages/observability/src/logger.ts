import pino, { type Logger as PinoLogger, type DestinationStream } from 'pino';
import type { Logger } from '@so/sdk';

function wrap(p: PinoLogger): Logger {
  return {
    debug: (msg, meta) => p.debug(meta ?? {}, msg),
    info: (msg, meta) => p.info(meta ?? {}, msg),
    warn: (msg, meta) => p.warn(meta ?? {}, msg),
    error: (msg, meta) => p.error(meta ?? {}, msg),
    child: (bindings) => wrap(p.child(bindings)),
  };
}

export function createLogger(
  opts: { level?: string; name?: string } = {},
  stream?: DestinationStream,
): Logger {
  const options = { level: opts.level ?? 'info', name: opts.name ?? 'so' };
  return wrap(stream ? pino(options, stream) : pino(options));
}
