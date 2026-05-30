import createOpenapiClient from 'openapi-fetch';
import type { paths } from './schema.js';

/** A fully-typed SoftwareOntology API client generated from the OpenAPI spec. */
export function createClient(opts: { baseUrl: string }) {
  return createOpenapiClient<paths>({ baseUrl: opts.baseUrl, credentials: 'include' });
}
export type { paths } from './schema.js';
