/** The active project for a request, from the `X-Project` header (defaults to 'project_default'). */
export function activeProjectId(headers: Record<string, string | string[] | undefined>): string {
  const v = headers['x-project'];
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.trim() ? s.trim() : 'project_default';
}

/** The active branch for a request, from the `X-Branch` header (defaults to 'main'). */
export function activeBranch(headers: Record<string, string | string[] | undefined>): string {
  const v = headers['x-branch'];
  const s = Array.isArray(v) ? v[0] : v;
  const b = s && s.trim() ? s.trim() : 'main';
  return /^[A-Za-z0-9_-]+$/.test(b) ? b : 'main';
}
