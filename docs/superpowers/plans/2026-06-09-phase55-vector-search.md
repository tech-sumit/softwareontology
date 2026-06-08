# Phase 55 — AIP Vector Semantic Search Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps `- [ ]`.

**Goal:** Embedding-based **semantic search over objects**: an `embeddings()` provider method (echo = deterministic hash embedding so it's testable; http = real model), an `aip_embeddings` index, an index/search API, and a search panel on the **Ask** surface.

**Architecture:** Lives in `@so/aip`. No pgvector (plain postgres:16) → vectors stored as `jsonb`, **cosine computed in TS**. Index resolves an object type's objects, builds a doc from its string properties, embeds, upserts. Search embeds the query and ranks by cosine.

---

## Pre-flight
- [ ] **Branch:** `git checkout main && git checkout -b phase55/vector-search`

---

## Task 1: Embedding + cosine helpers (pure, unit-tested)

**Files:** Create `packages/aip/src/embed.ts`, `packages/aip/test/embed.test.ts`

- [ ] **Step 1: `embed.ts`**
```ts
export const EMBED_DIM = 64;
/** Deterministic bag-of-words hash embedding — texts sharing tokens get higher cosine. Used by the echo provider + as a local fallback. */
export function hashEmbed(text: string): number[] {
  const v = new Array<number>(EMBED_DIM).fill(0);
  for (const tok of text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) {
    let h = 2166136261;
    for (let i = 0; i < tok.length; i++) { h ^= tok.charCodeAt(i); h = Math.imul(h, 16777619); }
    v[Math.abs(h) % EMBED_DIM]! += 1;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}
export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]!; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}
```

- [ ] **Step 2: `embed.test.ts`**
```ts
import { describe, it, expect } from 'vitest';
import { hashEmbed, cosine, EMBED_DIM } from '../src/embed.js';
describe('embeddings', () => {
  it('produces normalized vectors of fixed length', () => {
    const v = hashEmbed('hello world');
    expect(v).toHaveLength(EMBED_DIM);
    expect(Math.abs(Math.sqrt(v.reduce((s, x) => s + x * x, 0)) - 1)).toBeLessThan(1e-9);
  });
  it('ranks semantically closer text higher', () => {
    const q = hashEmbed('delayed flight to boston');
    const near = hashEmbed('the flight to boston was delayed');
    const far = hashEmbed('quarterly revenue spreadsheet totals');
    expect(cosine(q, near)).toBeGreaterThan(cosine(q, far));
  });
});
```

- [ ] **Step 3: Run → PASS:** `pnpm --filter @so/aip test` (timeout 120000).

---

## Task 2: Provider embeddings + index/search service + routes

**Files:** Modify `packages/aip/src/service.ts`, `packages/aip/src/routes.ts`; Create `packages/aip/src/migrate.ts`; Modify `packages/aip/src/index.ts`

- [ ] **Step 1: `migrate.ts`** (new)
```ts
import { applyMigrations, type Db } from '@so/sdk';
const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS aip_embeddings (
    org_id      text NOT NULL,
    object_type text NOT NULL,
    primary_key text NOT NULL,
    doc         text NOT NULL,
    vector      jsonb NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (org_id, object_type, primary_key)
  )`,
];
export async function runMigrations(db: Db): Promise<void> { await applyMigrations(db, 'aip', MIGRATIONS); }
```

- [ ] **Step 2: `index.ts`** — READ it. Ensure migrations run on install: import `{ runMigrations }` from `./migrate.js` and call it in `onInstall` (if an `onInstall` already exists, add the call; otherwise add `onInstall: async (ctx) => { await runMigrations(ctx.db); }` to the module definition, matching how other modules with a migrate.ts do it).

- [ ] **Step 3: `service.ts`** — READ it. Add `import { hashEmbed, cosine } from './embed.js';`. Extend the `Provider` interface to `{ complete(prompt: string): Promise<string>; embeddings(text: string): Promise<number[]> }` and implement on BOTH providers:
  - echo: `async embeddings(text: string): Promise<number[]> { return hashEmbed(text); }`
  - http: 
    ```ts
    async embeddings(text: string): Promise<number[]> {
      const url = `${endpoint.replace(/\/$/, '')}/embeddings`;
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: text }) });
      if (!res.ok) throw new Error(`AIP embeddings error: ${res.status}`);
      const data = (await res.json()) as { embedding?: number[] };
      return data.embedding ?? [];
    }
    ```
  Then add (using the SAME `ontology` handle that `ask` already uses, and `ctx.db`):
```ts
  function docFor(obj: Record<string, unknown>, stringProps: string[], pk: string): string {
    const parts = stringProps.map((p) => `${p}: ${obj[p] ?? ''}`).filter((s) => !s.endsWith(': '));
    return parts.join(' · ') || String(obj[pk] ?? '');
  }
  async function indexObjectType(orgId: string, objectType: string): Promise<{ indexed: number }> {
    const ot = await ontology.getObjectType(orgId, objectType);
    if (!ot) throw new Error('unknown object type');
    const stringProps = ot.properties.filter((p) => p.type === 'string').map((p) => p.apiName);
    const pk = ot.primaryKey;
    const objects = await ontology.resolveObjects(orgId, objectType, { limit: 1000 });
    const p = provider();
    let indexed = 0;
    for (const obj of objects) {
      const key = String(obj[pk] ?? '');
      if (!key) continue;
      const doc = docFor(obj, stringProps, pk);
      const vec = await p.embeddings(doc);
      await ctx.db.query(
        `INSERT INTO aip_embeddings(org_id,object_type,primary_key,doc,vector) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (org_id,object_type,primary_key) DO UPDATE SET doc=EXCLUDED.doc, vector=EXCLUDED.vector, updated_at=now()`,
        [orgId, objectType, key, doc, JSON.stringify(vec)],
      );
      indexed++;
    }
    return { indexed };
  }
  async function search(orgId: string, objectType: string, query: string, k = 10): Promise<Array<{ primaryKey: string; score: number; doc: string }>> {
    const qv = await provider().embeddings(query);
    const rows = await ctx.db.query<{ primary_key: string; doc: string; vector: number[] }>(
      `SELECT primary_key, doc, vector FROM aip_embeddings WHERE org_id = $1 AND object_type = $2`, [orgId, objectType]);
    const scored = rows.map((r) => ({ primaryKey: r.primary_key, doc: r.doc, score: cosine(qv, Array.isArray(r.vector) ? r.vector : []) }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, Math.max(1, Math.min(k, 100)));
  }
```
  Add `indexObjectType, search` to the service's returned object.
  > Note: `ctx.db.query` returns jsonb columns already parsed to JS — `r.vector` is a `number[]`. The `Array.isArray` guard is belt-and-suspenders.

- [ ] **Step 4: `routes.ts`** — add two routes (perm `aip:use`, matching the existing routes' style):
```ts
  fastify.post('/index', { preHandler: requirePermission('aip:use') }, async (req, reply) => {
    const b = req.body as { objectType?: string };
    if (!b?.objectType) return reply.code(400).send({ error: 'objectType required' });
    try { return reply.send(await svc.indexObjectType(req.user!.orgId, b.objectType)); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });
  fastify.post('/search', { preHandler: requirePermission('aip:use') }, async (req, reply) => {
    const b = req.body as { objectType?: string; query?: string; k?: number };
    if (!b?.objectType || !b?.query) return reply.code(400).send({ error: 'objectType and query required' });
    try { return reply.send({ results: await svc.search(req.user!.orgId, b.objectType, b.query, b.k ?? 10) }); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });
```

- [ ] **Step 5: typecheck** `pnpm --filter @so/aip typecheck` → 0. Commit: `git add -A && git commit -m "feat(aip): embedding-based semantic search over objects" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"`

---

## Task 3: E2E proves the full path

**Files:** Modify the e2e suite (`packages/e2e/test/*.ts` — READ it to find the object type it models and a string value present in the data)

- [ ] **Step 1** — after the e2e has modeled + resolved an object type, add an index + search assertion. Use the object type's apiName already used in the test and a query term that appears in its seeded string data:
```ts
    const idx = await app.inject({ method: 'POST', url: '/api/aip/index', headers: auth, payload: { objectType: <THE_OBJECT_TYPE_APINAME> } });
    expect(idx.statusCode).toBe(200);
    expect(idx.json().indexed).toBeGreaterThan(0);
    const sr = await app.inject({ method: 'POST', url: '/api/aip/search', headers: auth, payload: { objectType: <THE_OBJECT_TYPE_APINAME>, query: <A_WORD_FROM_THE_DATA> } });
    expect(sr.statusCode).toBe(200);
    const results = sr.json().results as Array<{ primaryKey: string; score: number }>;
    expect(results.length).toBeGreaterThan(0);
    expect(typeof results[0]!.score).toBe('number');
```
(Match the e2e's actual variable names for the app instance + auth cookie/header.)

- [ ] **Step 2: Run → PASS:** `pnpm --filter @so/e2e test` (timeout 180000).

---

## Task 4: API + UI (search on the Ask surface)

**Files:** Modify `apps/web/src/api.ts`, `apps/web/src/views/AskView.tsx`, `apps/web/src/help.ts`; Create `apps/web/src/components/SearchResults.tsx` (+ `.test.tsx`)

- [ ] **Step 1: `api.ts`** — add:
```ts
  aipIndex: (objectType: string) => req<{ indexed: number }>('POST', '/aip/index', { objectType }),
  aipSearch: (objectType: string, query: string, k = 10) => req<{ results: Array<{ primaryKey: string; score: number; doc: string }> }>('POST', '/aip/search', { objectType, query, k }),
```

- [ ] **Step 2: `SearchResults.tsx`**
```tsx
export type SearchHit = { primaryKey: string; score: number; doc: string };
export function SearchResults({ hits }: { hits: SearchHit[] }) {
  if (hits.length === 0) return <p className="muted">No results yet — index a type, then search.</p>;
  return (
    <ul className="searchres" style={{ listStyle: 'none', padding: 0 }}>
      {hits.map((h) => (
        <li key={h.primaryKey} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
          <span className="badge">{h.score.toFixed(3)}</span> <strong>{h.primaryKey}</strong>
          <div className="muted" style={{ fontSize: 13 }}>{h.doc}</div>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 3: `SearchResults.test.tsx`**
```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { SearchResults } from './SearchResults';
describe('SearchResults', () => {
  it('renders ranked hits', () => {
    render(<SearchResults hits={[{ primaryKey: 'BA123', score: 0.87, doc: 'status: delayed' }]} />);
    expect(screen.getByText('BA123')).toBeInTheDocument();
    expect(screen.getByText('0.870')).toBeInTheDocument();
  });
  it('shows an empty state', () => {
    render(<SearchResults hits={[]} />);
    expect(screen.getByText(/No results yet/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: `AskView.tsx`** — READ it. Add a "Semantic search" card BELOW the existing ask UI. It loads object types on mount (`api.listObjectTypes()`), and renders: a type `<select>`, an **Index** button (`api.aipIndex(type)` → set a status like `Indexed N objects.`), a query `<input>`, a **Search** button (`api.aipSearch(type, query)` → `setHits(results)`), and `<SearchResults hits={hits} />`. Follow AskView's existing state/error style. Concretely add (adapt to the file's existing imports/patterns):
```tsx
// state
const [types, setTypes] = useState<Array<{ apiName: string }>>([]);
const [stype, setStype] = useState('');
const [q, setQ] = useState('');
const [hits, setHits] = useState<SearchHit[]>([]);
const [smsg, setSmsg] = useState('');
useEffect(() => { api.listObjectTypes().then((r) => { setTypes(r.objectTypes); if (r.objectTypes[0]) setStype(r.objectTypes[0].apiName); }).catch(() => {}); }, []);
async function doIndex() { setSmsg('Indexing…'); try { const r = await api.aipIndex(stype); setSmsg(`Indexed ${r.indexed} objects.`); } catch (e) { setSmsg((e as Error).message); } }
async function doSearch() { try { setHits((await api.aipSearch(stype, q)).results); } catch (e) { setSmsg((e as Error).message); } }
```
```tsx
// JSX (a new card under the existing content)
<div className="card" style={{ marginTop: 18 }}>
  <h3>Semantic search</h3>
  <p className="muted">Embed an object type, then search it by meaning (not just keywords).</p>
  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
    <select aria-label="search type" value={stype} onChange={(e) => setStype(e.target.value)}>{types.map((t) => <option key={t.apiName} value={t.apiName}>{t.apiName}</option>)}</select>
    <button className="sec" onClick={doIndex}>Index</button>
    <input aria-label="search query" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. delayed flights to Boston" style={{ minWidth: 260 }} onKeyDown={(e) => { if (e.key === 'Enter') doSearch(); }} />
    <button onClick={doSearch}>Search</button>
  </div>
  {smsg ? <div className="muted" style={{ marginTop: 8 }}>{smsg}</div> : null}
  <div style={{ marginTop: 12 }}><SearchResults hits={hits} /></div>
</div>
```
(Confirm `listObjectTypes` returns `{ objectTypes: Array<{ apiName: ... }> }` in `api.ts`; match its real shape. Import `SearchResults`, `type SearchHit`, and `useEffect/useState` as needed.)

- [ ] **Step 5: `help.ts`** — update the `'console:ask'` entry to mention semantic search, e.g. add a step: `'Under Semantic search, pick a type, click Index once, then search it by meaning.'`

- [ ] **Step 6: Verify:** `pnpm --filter @so/web typecheck` (0); `pnpm --filter @so/web test` (all pass incl. SearchResults); `pnpm --filter @so/web build`. No unused imports; no `eslint-disable react-hooks/exhaustive-deps`.
- [ ] **Step 7: Commit:** `git add -A && git commit -m "feat(web): semantic search panel on the Ask surface" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"`

---

## Task 5: Full verification + merge (GATED)
- [ ] Run:
```bash
cd /Users/sumitagrawal/CODE/sumit/SoftwareOntology
pnpm run infra:up && pnpm run infra:seed
pnpm typecheck; tc=$?
pnpm lint; lint=$?
pnpm test >/tmp/p55.log 2>&1; t=$?
grep -E "Tests +[0-9]+ (passed|failed)" /tmp/p55.log | tail -1
echo "tc=$tc lint=$lint t=$t"
if [ $tc -eq 0 ] && [ $lint -eq 0 ] && [ $t -eq 0 ]; then git checkout main && git merge --ff-only phase55/vector-search && echo MERGED; else echo "NOT MERGING"; fi
```
(Flaky env: re-run once on mass ~60000ms timeouts / `ERR_IPC_CHANNEL_CLOSED` after confirming `docker info`.)

---

## Self-review
- **Semantic search** — embeddings provider method + `aip_embeddings` jsonb store + TS cosine + index/search routes. ✓
- **Testable without a real LLM** — echo provider returns a deterministic hash embedding; pure unit test proves ranking; e2e proves the full upload→model→index→search path. ✓
- **Real-model ready** — http provider posts to `<endpoint>/embeddings`; swap `AIP_PROVIDER=http`. ✓
- **UI** — search panel on Ask with Index + ranked results (tested `SearchResults`); help updated. ✓
- **Deferred (flagged):** background/batched re-index job (currently synchronous per request); pgvector/ANN index for large object sets (linear cosine scan is fine for moderate N). Feeds **Plan 56** (agent uses `search` as a tool).
