# Phase 50 — Production Polish Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps `- [ ]`.

**Goal:** Production-grade finish: make the **top-bar search work** (→ Console Catalog), add an **SSO sign-in** option, remove dead code, and a **design-consistency pass** (replace lingering dark inline styles in surface views with the light-theme tokens; ensure empty states).

**Architecture:** Small, surgical: extend `TopBar` (onSearch) + `LoginForm` (onSso) [both jsdom-tested]; `CatalogView` accepts `initialQuery`; `App` wires both; remove orphan `ExplorerView.tsx`; token-ize stray dark hex colors in `apps/web/src/views/*`.

---

## Pre-flight
- [ ] **Branch:** `git checkout main && git checkout -b phase50/production-polish`

---

## Task 1: Working global search

**Files:** Modify `apps/web/src/components/TopBar.tsx` (+ test), `apps/web/src/views/CatalogView.tsx`, `apps/web/src/App.tsx`

- [ ] **Step 1: `TopBar.tsx`** — add an optional `onSearch`; fire it on Enter:
```tsx
export function TopBar({ breadcrumb, userEmail, onSignOut, onSearch }: { breadcrumb: string[]; userEmail: string; onSignOut: () => void; onSearch?: (q: string) => void }) {
  return (
    <div className="topbar2">
      <div className="crumb2">{breadcrumb.map((b, i) => (<span key={i}>{i > 0 ? <span className="sepc">/</span> : null}<span className={i === breadcrumb.length - 1 ? 'cur' : ''}>{b}</span></span>))}</div>
      <div className="spacer" />
      <input className="search2" placeholder="Search…" aria-label="search" onKeyDown={(e) => { if (e.key === 'Enter' && onSearch) onSearch((e.target as HTMLInputElement).value); }} />
      <span className="muted" style={{ fontSize: 13 }}>{userEmail}</span>
      <button className="sec" onClick={onSignOut}>Sign out</button>
    </div>
  );
}
```

- [ ] **Step 2: Extend `TopBar.test.tsx`** — add a case: render with `onSearch`, type into the search, press Enter, expect `onSearch` called with the value:
```tsx
  it('fires onSearch on Enter', () => {
    const onSearch = vi.fn();
    render(<TopBar breadcrumb={['Console']} userEmail="a@x.com" onSignOut={() => {}} onSearch={onSearch} />);
    const box = screen.getByLabelText('search');
    fireEvent.change(box, { target: { value: 'flights' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSearch).toHaveBeenCalledWith('flights');
  });
```

- [ ] **Step 3: `CatalogView.tsx`** — accept an optional `initialQuery` prop; if provided, prefill the search box and run the search on mount. (READ the file; add `{ initialQuery }: { initialQuery?: string } = {}` and seed the query state + an initial search effect.)

- [ ] **Step 4: `App.tsx`** — add `searchQuery` state; pass `onSearch={(q) => { setArea('console'); setView('catalog'); setSearchQuery(q); }}` to `<TopBar />`; render the console `catalog` case as `<CatalogView initialQuery={searchQuery} key={searchQuery} />` (keyed so a new search re-runs).

---

## Task 2: SSO sign-in

**Files:** Modify `apps/web/src/components/LoginForm.tsx` (+ test), `apps/web/src/App.tsx`

- [ ] **Step 1: `LoginForm.tsx`** — READ it; add an optional `onSso?: () => void`; render a secondary button under the submit: `{onSso ? <button type="button" className="sec" onClick={onSso}>Sign in with SSO</button> : null}`.

- [ ] **Step 2: Extend `LoginForm.test.tsx`** — add: render with `onSso`, click "Sign in with SSO", expect `onSso` called.

- [ ] **Step 3: `App.tsx`** — pass `onSso={() => { window.location.href = '/api/auth/oidc/login'; }}` to `<LoginForm />`.

---

## Task 3: Cleanup + design consistency

- [ ] **Step 1: Remove orphan** — `git rm apps/web/src/views/ExplorerView.tsx` (grep first to confirm nothing imports it — it was orphaned in Plan 47).

- [ ] **Step 2: Token-ize stray dark styles** — grep the surface views for dark hex literals that clash with the light content theme and replace with the design tokens:
  - `grep -rnE "#2a2f37|#161b22|#11161d|#1f6feb22|#0d1117|#8a929c" apps/web/src/views apps/web/src/components` — for each: a dark **border** color → `var(--line)`; a dark **bg** → remove or `var(--panel)`; `#8a929c` muted text → `var(--muted)`. Keep layout/spacing; only fix colors that look wrong on the light content area. Do NOT touch `styles.css` (rail/sidebar are intentionally dark) or the rail/sidebar component class usage.
  - Quick visual sanity: `pnpm --filter @so/web build` then spot-check no broken styles in the changed views (typecheck/build is enough; no runtime test needed).

- [ ] **Step 3: Verify:** `pnpm --filter @so/web typecheck` (0); `pnpm --filter @so/web test` (all pass incl. the extended TopBar + LoginForm tests); `pnpm --filter @so/web build`. No unused imports; no `eslint-disable react-hooks/exhaustive-deps`.

- [ ] **Step 4: Commit:** `git add -A && git commit -m "feat(web): production polish — working search, SSO sign-in, design consistency, cleanup"`

---

## Task 4: Full verification + merge (GATED)
- [ ] `pnpm run infra:up && pnpm run infra:seed && pnpm typecheck; pnpm lint`; then `pnpm test >/tmp/v.log 2>&1; t=$?; grep -E "Tests +[0-9]+ (passed|failed)" /tmp/v.log | tail -1`. **Only if tc/lint/`t` all 0**: `git checkout main && git merge --ff-only phase50/production-polish`. (Flaky env: re-run on mass timeouts / `ERR_IPC_CHANNEL_CLOSED`; ensure Docker up.)

---

## Self-review
- **Search works** — top-bar search routes to Console Catalog and runs the query. ✓
- **SSO** — a "Sign in with SSO" button kicks off the OIDC flow; password login unchanged. ✓
- **Cleaner + consistent** — orphan removed; stray dark inline styles token-ized to the light theme. ✓
- **Testable** — extended `TopBar` + `LoginForm` jsdom tests. ✓
- **Deferred:** global toast system; loading spinners on every fetch; in-place role/permission editing; richer search result types. Flagged — the platform is feature-complete + production-grade; these are incremental refinements.
