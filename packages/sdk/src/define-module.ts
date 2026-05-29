import type { ModuleDefinition } from './types.js';

const ID_RE = /^[a-z][a-z0-9-]*$/;

/** Identity helper that validates a module definition and preserves its type. */
export function defineModule(def: ModuleDefinition): ModuleDefinition {
  if (!ID_RE.test(def.id)) {
    throw new Error(`Invalid module id "${def.id}": must match ${ID_RE.source}`);
  }
  return def;
}
