# Phase 47 — Ontology Manager (full modeling UI) Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps `- [ ]`.

**Goal:** Turn the read-only Explorer into a full **Ontology manager**: for any object type see its **properties** (with type + security), **computed functions**, and **links**; and **create** object types (model a project dataset), **functions**, **link-types**, and **set property-level security**. Surfaces the entire ontology backend that had no UI.

**Architecture:** Two small backend reads (`GET /ontology/link-types`; include `functions`+`links` in `getObjectType`), matching `api.ts` methods, a pure `PropertyTable` (jsdom-tested), and an `OntologyManager` view that replaces `ExplorerView` in the Console `ontology` slot.

---

## Pre-flight
- [ ] **Branch:** `git checkout main && git checkout -b phase47/ontology-manager`

---

## Task 1: Backend read endpoints (`@so/ontology`)

**Files:** Modify `packages/ontology/src/service.ts`, `packages/ontology/src/routes.ts`

- [ ] **Step 1: `service.ts`** — add a `listLinkTypes`:
```ts
  async function listLinkTypes(orgId: string): Promise<Array<{ apiName: string; fromObjectType: string; toObjectType: string; foreignKeyProperty: string }>> {
    return ctx.db.query(`SELECT api_name AS "apiName", from_object_type AS "fromObjectType", to_object_type AS "toObjectType", foreign_key_property AS "foreignKeyProperty" FROM link_types WHERE org_id = $1 ORDER BY api_name`, [orgId]);
  }
```
(Read the real `link_types` column names from `migrate.ts` first; adjust the `SELECT ... AS` aliases to match. Add `listLinkTypes` to the returned service object.)

- [ ] **Step 2: `routes.ts`** — (a) in `GET /object-types/:apiName`, include functions + links in the response:
```ts
    const links = (await svc.listLinkTypes(req.user!.orgId)).filter((l) => l.fromObjectType === ot.apiName);
    return { objectType: { apiName: ot.apiName, datasetId: ot.datasetId, primaryKey: ot.primaryKey, properties: ot.properties, functions: ot.functions ?? [], links } };
```
(b) add a list route:
```ts
  fastify.get('/link-types', { preHandler: requirePermission('ontology:read') }, async (req) => ({ linkTypes: await svc.listLinkTypes(req.user!.orgId) }));
```
(If `getObjectType`'s `ot` doesn't carry `functions`, read the service — `ObjectTypeDetail.functions` exists; ensure `getObjectType` populates it. If not, populate from the `object_functions` table.)

- [ ] **Step 3: Run the ontology suite (regression) → PASS:** `pnpm run infra:up && pnpm --filter @so/ontology test` (timeout 180000). Existing ontology/functions/links/rls tests stay green; typecheck clean.

- [ ] **Step 4: Commit:** `git add -A && git commit -m "feat(ontology): list link-types + include functions/links in getObjectType"`

---

## Task 2: API methods + `PropertyTable` (+ test)

**Files:** Modify `apps/web/src/api.ts`; Create `apps/web/src/components/PropertyTable.tsx` (+ `.test.tsx`)

- [ ] **Step 1: `api.ts`** — extend `getObjectType` return type and add methods:
```ts
  getObjectType: (n: string) => req<{ objectType: { apiName: string; datasetId: string; primaryKey: string; properties: Array<{ apiName: string; column: string; type: string; requiredPermission?: string | null }>; functions: Array<{ apiName: string; expression: string; type: string }>; links: Array<{ apiName: string; fromObjectType: string; toObjectType: string; foreignKeyProperty: string }> } }>('GET', `/ontology/object-types/${n}`),
  getDataset: (id: string) => req<{ dataset: { id: string; name: string; columns: Array<{ name: string; duckType: string }> } }>('GET', `/datasets/${id}`),
  createObjectType: (body: unknown) => req<{ objectType: unknown }>('POST', '/ontology/object-types', body),
  createFunction: (objectType: string, body: { apiName: string; expression: string; type: string }) => req<{ ok: boolean }>('POST', `/ontology/object-types/${objectType}/functions`, body),
  createLinkType: (body: { apiName: string; fromObjectType: string; toObjectType: string; foreignKeyProperty: string }) => req<{ ok: boolean }>('POST', '/ontology/link-types', body),
  setPropertySecurity: (objectType: string, propName: string, requiredPermission: string | null) => req<{ ok: boolean }>('POST', `/ontology/object-types/${objectType}/properties/${propName}/security`, { requiredPermission }),
  listLinkTypes: () => req<{ linkTypes: Array<{ apiName: string; fromObjectType: string; toObjectType: string; foreignKeyProperty: string }> }>('GET', '/ontology/link-types'),
```
(If `getObjectType`/`createObjectType` already exist, REPLACE/keep one definition — no duplicates. `listObjectTypes`, `getObjects`, `listDatasets` already exist.)

- [ ] **Step 2: `components/PropertyTable.tsx`**
```tsx
export interface Prop { apiName: string; column?: string; type: string; requiredPermission?: string | null }
export function PropertyTable({ properties, onSecure }: { properties: Prop[]; onSecure?: (p: string, perm: string | null) => void }) {
  if (properties.length === 0) return <p style={{ color: 'var(--muted)' }}>No properties.</p>;
  return (
    <table>
      <thead><tr><th>Property</th><th>Column</th><th>Type</th><th>Security</th></tr></thead>
      <tbody>
        {properties.map((p) => (
          <tr key={p.apiName}>
            <td><b>{p.apiName}</b></td><td className="muted">{p.column ?? '—'}</td><td>{p.type}</td>
            <td>{p.requiredPermission ? <span className="badge bad">requires {p.requiredPermission}</span> : <span className="muted">public</span>}
              {onSecure ? <button className="sec" style={{ marginLeft: 8 }} onClick={() => { const v = window.prompt(`Required permission for "${p.apiName}" (blank = public)`, p.requiredPermission ?? ''); if (v !== null) onSecure(p.apiName, v.trim() || null); }}>Secure</button> : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 3: `components/PropertyTable.test.tsx`**
```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PropertyTable } from './PropertyTable';
describe('PropertyTable', () => {
  it('shows type + security and secures on click', () => {
    const onSecure = vi.fn(); const prompt = vi.spyOn(window, 'prompt').mockReturnValue('salary:read');
    render(<PropertyTable properties={[{ apiName: 'salary', column: 'sal', type: 'int', requiredPermission: null }]} onSecure={onSecure} />);
    expect(screen.getByText('int')).toBeInTheDocument();
    expect(screen.getByText('public')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Secure'));
    expect(onSecure).toHaveBeenCalledWith('salary', 'salary:read');
    prompt.mockRestore();
  });
  it('empty state', () => { render(<PropertyTable properties={[]} />); expect(screen.getByText(/no properties/i)).toBeInTheDocument(); });
});
```

- [ ] **Step 4: Run → PASS:** `pnpm --filter @so/web test -- PropertyTable` (timeout 120000).

---

## Task 3: `OntologyManager` view + nav wiring

**Files:** Create `apps/web/src/views/OntologyManager.tsx`; Modify `apps/web/src/App.tsx`

- [ ] **Step 1: `OntologyManager.tsx`** — a manager that:
  - On mount loads `api.listObjectTypes()`. Left column lists types (+ a **New object type** button that opens an inline form). Selecting a type calls `api.getObjectType(name)` and shows its detail.
  - Type detail: header (name · primaryKey · backing datasetId); **Properties** via `<PropertyTable properties={ot.properties} onSecure={(p,perm)=>api.setPropertySecurity(name,p,perm).then(reload)} />`; **Functions** (list `ot.functions` as `apiName = expression : type` rows + an "Add function" form: apiName/expression/type→`api.createFunction`); **Links** (list `ot.links` as `apiName → toObjectType (fk: foreignKeyProperty)` + an "Add link" form: apiName, `toObjectType` select from all types, `foreignKeyProperty` select from this type's properties →`api.createLinkType`); a **Browse objects** button → `api.getObjects(name)` shown via the existing `ObjectsTable` component.
  - New object type form: select a project dataset (`api.listDatasets()`); on select, `api.getDataset(id)` → auto-fill a property row per column (`apiName=column`, `column=column`, `type` default `string`, editable via a `<select>` of string/int/double/bool/date); choose `primaryKey` (select among columns); enter `apiName`; submit `api.createObjectType({apiName,datasetId,primaryKey,properties})` → reload list.
  - Use `card`/`err`/`badge`/`chip` classes + a green msg line; surface errors inline. Type the props (`type Prop` from PropertyTable; define small local interfaces for functions/links).

- [ ] **Step 2: Wire nav — `App.tsx`** — import `OntologyManager`; change the console `case 'ontology':` from `<ExplorerView />` to `<OntologyManager />`. (Leave `ExplorerView` file in place for now — it's still imported? If no longer used, remove its import to keep lint clean; the `ontology` slot is its only user, so remove the `ExplorerView` import.)

- [ ] **Step 3: Verify the web package:** `pnpm --filter @so/web typecheck` (0); `pnpm --filter @so/web test` (all pass incl. PropertyTable); `pnpm --filter @so/web build` (succeeds). (timeout 180000). No unused imports (drop `ExplorerView` import if unused); no `eslint-disable react-hooks/exhaustive-deps`.

- [ ] **Step 4: Commit:** `git add -A && git commit -m "feat(web): Ontology manager — properties/functions/links, create + secure"`

---

## Task 4: Full verification + merge (GATED)
- [ ] `pnpm run infra:up && pnpm run infra:seed && pnpm typecheck; pnpm lint`; then `pnpm test >/tmp/v.log 2>&1; t=$?; grep -E "Tests +[0-9]+ (passed|failed)" /tmp/v.log | tail -1`. **Only if tc/lint/`t` all 0**: `git checkout main && git merge --ff-only phase47/ontology-manager`. (Flaky env: re-run on mass ~60000ms timeouts / `ERR_IPC_CHANNEL_CLOSED` with tests otherwise passing; ensure Docker up.)

---

## Self-review
- **Ontology fully surfaced** — properties (w/ security), computed functions, links all viewable + creatable; property-level RLS settable; model a new object type from a dataset. Closes the biggest backend→UI gap. ✓
- **Minimal backend** — only two READ additions (`listLinkTypes`, functions/links in `getObjectType`); all writes already existed. ✓
- **Testable** — pure `PropertyTable` jsdom-tested; backend reads covered by the ontology suite. ✓
- **Deferred → Plan 48:** object detail panel, link *traversal* in the UI (`resolveLinkedObjects`), and running **actions**; object-type delete/edit. Flagged.
