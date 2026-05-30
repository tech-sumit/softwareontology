/* global URL, console */
// Regenerate the typed schema from the served OpenAPI spec.
// Run under `tsx` (not plain `node`): importing `@so/openapi` pulls in the
// workspace TS source graph (which uses `.js`-extensioned imports of `.ts` files),
// so a TS-aware loader is required to resolve `openapiSpec`.
import { writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { openapiSpec } from '@so/openapi';

await writeFile(new URL('./openapi.json', import.meta.url), JSON.stringify(openapiSpec, null, 2));
execFileSync('pnpm', ['exec', 'openapi-typescript', new URL('./openapi.json', import.meta.url).pathname, '-o', new URL('./src/schema.ts', import.meta.url).pathname], { stdio: 'inherit' });
console.log('generated src/schema.ts');
