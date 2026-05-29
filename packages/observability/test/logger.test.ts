import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import { createLogger } from '../src/logger.js';

function collector() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) { lines.push(chunk.toString()); cb(); },
  });
  return { lines, stream };
}

describe('createLogger', () => {
  it('emits structured JSON with message and metadata', () => {
    const { lines, stream } = collector();
    const log = createLogger({ level: 'debug' }, stream);
    log.info('hello', { a: 1 });
    const rec = JSON.parse(lines[0]!);
    expect(rec.msg).toBe('hello');
    expect(rec.a).toBe(1);
  });

  it('child loggers carry bindings', () => {
    const { lines, stream } = collector();
    const log = createLogger({ level: 'debug' }, stream);
    log.child({ mod: 'ontology' }).warn('careful');
    const rec = JSON.parse(lines[0]!);
    expect(rec.mod).toBe('ontology');
    expect(rec.msg).toBe('careful');
  });
});
