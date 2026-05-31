/** The active project for a request, from the `X-Project` header (defaults to 'project_default'). */
export function activeProjectId(headers: Record<string, string | string[] | undefined>): string {
  const v = headers['x-project'];
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.trim() ? s.trim() : 'project_default';
}
