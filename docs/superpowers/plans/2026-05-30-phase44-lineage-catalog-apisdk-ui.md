# Phase 44 — Lineage + Catalog + API & SDK Surface UIs Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps `- [ ]`.

**Goal:** Fill the last three placeholder PLATFORM surfaces with read views wiring existing backends:
- **Lineage** — pick an object type, show its backing dataset + actions + links.
- **Catalog** — global search + audit log.
- **API & SDK** — list the platform's OpenAPI endpoints + how to get the typed SDK.

**Architecture:** A pure `EndpointList` component (jsdom-tested) + stateful `LineageView`, `CatalogView`, `ApiSdkView`. New `api.ts` methods. `App.tsx` swaps the three placeholders.

> The subagent MUST read the actual routes for exact response shapes: `packages/lineage/src/routes.ts`, `packages/catalog/src/routes.ts`, `packages/openapi/src/*` (the `/openapi/spec` shape), and reuse the existing `api.listObjectTypes`.

---

## Pre-flight
- [ ] **Branch:** `git checkout main && git checkout -b phase44/lineage-catalog-apisdk-ui`

---

## Task 1: API methods

**Files:** Modify `apps/web/src/api.ts` — add (adjust types/paths to the real route shapes you read):
```ts
  getLineage: (objectType: string) => req<{ objectType: { apiName: string; datasetId?: string; actions?: string[]; links?: unknown[] } }>('GET', `/lineage/object-types/${objectType}`),
  catalogAudit: () => req<{ entries: Array<Record<string, unknown>> }>('GET', '/catalog/audit'),
  catalogSearch: (q: string) => req<{ results: Array<Record<string, unknown>> }>('GET', `/catalog/search?q=${encodeURIComponent(q)}`),
  openapiSpec: () => req<{ paths: Record<string, Record<string, unknown>> }>('GET', '/openapi/spec'),
```
(Fix each return type to match the real responses. `listObjectTypes` already exists — reuse it for the Lineage picker.)

---

## Task 2: `EndpointList` pure component (+ test)

**Files:** Create `apps/web/src/components/EndpointList.tsx`, `apps/web/src/components/EndpointList.test.tsx`

- [ ] **Step 1: `EndpointList.tsx`**
```tsx
export function EndpointList({ endpoints }: { endpoints: Array<{ method: string; path: string }> }) {
  if (endpoints.length === 0) return <p style={{ color: '#8a929c' }}>No endpoints.</p>;
  return (
    <table>
      <thead><tr><th>Method</th><th>Path</th></tr></thead>
      <tbody>
        {endpoints.map((e, i) => (
          <tr key={i}><td><span className="badge running">{e.method.toUpperCase()}</span></td><td><code>{e.path}</code></td></tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 2: `EndpointList.test.tsx`**
```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { EndpointList } from './EndpointList';

describe('EndpointList', () => {
  it('renders method + path rows', () => {
    render(<EndpointList endpoints={[{ method: 'get', path: '/datasets' }, { method: 'post', path: '/pipelines' }]} />);
    expect(screen.getByText('GET')).toBeInTheDocument();
    expect(screen.getByText('/datasets')).toBeInTheDocument();
    expect(screen.getByText('POST')).toBeInTheDocument();
    expect(screen.getByText('/pipelines')).toBeInTheDocument();
  });
  it('empty state', () => {
    render(<EndpointList endpoints={[]} />);
    expect(screen.getByText(/no endpoints/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run → PASS:** `pnpm --filter @so/web test -- EndpointList` (timeout 120000).

---

## Task 3: Views + nav wiring

**Files:** Create `apps/web/src/views/LineageView.tsx`, `apps/web/src/views/CatalogView.tsx`, `apps/web/src/views/ApiSdkView.tsx`; Modify `apps/web/src/App.tsx`

- [ ] **Step 1: `LineageView.tsx`** — on mount load object types (`api.listObjectTypes`); a `<select>` to pick one; on change fetch `api.getLineage` and render its backing dataset id, actions, and links (whatever the route returns — render defensively). `card`/`err` classes.

- [ ] **Step 2: `CatalogView.tsx`** — a search input + button → `api.catalogSearch(q)` → results table (render keys of the first row as columns, or a simple JSON-ish list); below it, an Audit section loading `api.catalogAudit()` into a table. Render defensively against the real shapes. `card`/`err`.

- [ ] **Step 3: `ApiSdkView.tsx`** — on mount `api.openapiSpec()`; flatten `spec.paths` into `Array<{ method, path }>` (for each path, for each HTTP method key) and render with `EndpointList`. Add a short note: the full spec is served at `/api/openapi/spec`, and a typed client is generated via `pnpm gen:client` (the `@so/client` package). Include a link `<a href="/api/openapi/spec">raw spec</a>`. `card` class.

- [ ] **Step 4: Wire nav — `App.tsx`** — import the three views; change `case 'lineage':` → `<LineageView key={refreshKey} />`, `case 'catalog':` → `<CatalogView />`, `case 'apisdk':` → `<ApiSdkView />` (remove those `PlaceholderView` usages). (`PlaceholderView` may now be unused — if so, remove its import to keep lint clean; only `automations`? no — after this plan all surfaces are wired, so `PlaceholderView` import likely becomes unused → remove it AND the file if nothing references it.)

- [ ] **Step 5: Verify the web package:** `pnpm --filter @so/web typecheck` (0); `pnpm --filter @so/web test` (all pass incl. EndpointList); `pnpm --filter @so/web build` (succeeds). (timeout 180000). No unused imports (remove `PlaceholderView` import if unused); no `eslint-disable react-hooks/exhaustive-deps`.

- [ ] **Step 6: Commit:** `git add -A && git commit -m "feat(web): Lineage, Catalog, API & SDK surfaces"`

---

## Task 4: Full verification + merge (GATED)
- [ ] `pnpm typecheck; pnpm lint`; then `pnpm test >/tmp/v.log 2>&1; t=$?; grep -E "Tests +[0-9]+ (passed|failed)" /tmp/v.log | tail -1`. **Only if tc/lint/`t` all 0**: `git checkout main && git merge --ff-only phase44/lineage-catalog-apisdk-ui`. (Flaky env: re-run on mass timeouts / `ERR_IPC_CHANNEL_CLOSED` with tests otherwise passing; ensure Docker up.)

---

## Self-review
- **All surfaces now live** — Lineage, Catalog, and API & SDK complete the sidebar; no placeholders remain (verify `PlaceholderView` is removed if unused). ✓
- **API & SDK** — the platform's endpoints are browsable in-UI + SDK generation is documented; directly answers "I don't see API endpoints / SDK". ✓
- **Testable** — pure `EndpointList` jsdom-tested; views verified by typecheck+build; backends already in the green suite. ✓
- **Deferred:** lineage graph visualization (current is a per-type panel); catalog pagination/filters; Swagger-style try-it console. Flagged.
