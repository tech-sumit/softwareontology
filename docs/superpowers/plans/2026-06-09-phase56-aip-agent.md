# Phase 56 — AIP Tool-Using Agent Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps `- [ ]`.

**Goal:** An **agent** that answers questions by choosing **tools** over the ontology (list types · semantic search · sample objects · group-by aggregate), via a ReAct-style loop on the LLM provider — with a deterministic fallback so it's useful and testable under the `echo` provider.

**Architecture:** Lives in `@so/aip` (reuses Plan 55's `search` + the existing `ontology` handle — NO new module deps). Read-only tools only; action *execution* is deferred (flagged) to avoid autonomous writes. Returns `{ answer, steps[] }` so the UI can show its work.

---

## Pre-flight
- [ ] **Branch:** `git checkout main && git checkout -b phase56/aip-agent`

---

## Task 1: `parseAction` (pure, unit-tested)

**Files:** Create `packages/aip/src/agent.ts`, `packages/aip/test/agent.test.ts`

- [ ] **Step 1: `agent.ts`**
```ts
export type AgentAction = { tool: string; args: Record<string, unknown> } | { final: string };
/** Extract a single JSON action from an LLM reply; null if none parses (e.g. the echo provider). */
export function parseAction(text: string): AgentAction | null {
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s === -1 || e <= s) return null;
  try {
    const obj = JSON.parse(text.slice(s, e + 1)) as Record<string, unknown>;
    if (typeof obj.final === 'string') return { final: obj.final };
    if (typeof obj.tool === 'string') return { tool: obj.tool, args: (obj.args as Record<string, unknown>) ?? {} };
    return null;
  } catch { return null; }
}
```

- [ ] **Step 2: `agent.test.ts`**
```ts
import { describe, it, expect } from 'vitest';
import { parseAction } from '../src/agent.js';
describe('parseAction', () => {
  it('parses a tool call embedded in prose', () => {
    expect(parseAction('Sure. {"tool":"search","args":{"objectType":"Flight","query":"x"}} ok'))
      .toEqual({ tool: 'search', args: { objectType: 'Flight', query: 'x' } });
  });
  it('parses a final answer', () => { expect(parseAction('{"final":"done"}')).toEqual({ final: 'done' }); });
  it('returns null when there is no JSON action (echo)', () => {
    expect(parseAction('echo: you are an agent…')).toBeNull();
    expect(parseAction('no braces here')).toBeNull();
  });
});
```

- [ ] **Step 3: Run → PASS:** `pnpm --filter @so/aip test` (timeout 120000).

---

## Task 2: Agent loop + tools + route (`@so/aip`)

**Files:** Modify `packages/aip/src/service.ts`, `packages/aip/src/routes.ts`

- [ ] **Step 1: `service.ts`** — READ it (Plan 55 added `search`, `provider()`, the `ontology` handle, `ctx`). Add `import { parseAction } from './agent.js';`. Add the tools + agent (reuse the existing `ontology`, `provider`, and `search` in this closure):
```ts
  async function aggregateLocal(orgId: string, objectType: string, groupBy: string): Promise<Array<{ group: string; count: number }>> {
    const objs = await ontology.resolveObjects(orgId, objectType, { limit: 1000 });
    const m = new Map<string, number>();
    for (const o of objs) { const g = String(o[groupBy] ?? '∅'); m.set(g, (m.get(g) ?? 0) + 1); }
    return [...m.entries()].map(([group, count]) => ({ group, count })).sort((a, b) => b.count - a.count);
  }
  const tools: Array<{ name: string; description: string; run: (orgId: string, a: Record<string, unknown>) => Promise<unknown> }> = [
    { name: 'listTypes', description: 'List object type apiNames. args: {}', run: async (orgId) => (await ontology.listObjectTypes(orgId)).map((t) => t.apiName) },
    { name: 'search', description: 'Semantic search within a type. args: {objectType, query}', run: async (orgId, a) => search(orgId, String(a.objectType), String(a.query), 5) },
    { name: 'sample', description: 'Return some objects of a type. args: {objectType, limit}', run: async (orgId, a) => ontology.resolveObjects(orgId, String(a.objectType), { limit: Math.min(Number(a.limit) || 10, 50) }) },
    { name: 'aggregate', description: 'Group-by counts. args: {objectType, groupBy}', run: async (orgId, a) => aggregateLocal(orgId, String(a.objectType), String(a.groupBy)) },
  ];
  async function agent(orgId: string, question: string, opts?: { maxSteps?: number }): Promise<{ answer: string; steps: Array<{ tool: string; args: unknown; observation: string }> }> {
    const maxSteps = opts?.maxSteps ?? 4;
    const types = (await ontology.listObjectTypes(orgId)).map((t) => t.apiName);
    const catalog = tools.map((t) => `- ${t.name}: ${t.description}`).join('\n');
    const steps: Array<{ tool: string; args: unknown; observation: string }> = [];
    const p = provider();
    let history = '';
    for (let i = 0; i < maxSteps; i++) {
      const prompt = `You are an analytics agent over an object ontology. Object types: ${types.join(', ')}.\nTools:\n${catalog}\nReply with ONE JSON object: {"tool":"<name>","args":{...}} to call a tool, or {"final":"<answer>"} when done.\nQuestion: ${question}${history}`;
      const act = parseAction(await p.complete(prompt));
      if (!act) break;
      if ('final' in act) return { answer: act.final, steps };
      const tool = tools.find((t) => t.name === act.tool);
      let observation: string;
      if (!tool) observation = `unknown tool: ${act.tool}`;
      else { try { observation = JSON.stringify(await tool.run(orgId, act.args)).slice(0, 1500); } catch (e) { observation = `error: ${(e as Error).message}`; } }
      steps.push({ tool: act.tool, args: act.args, observation });
      history += `\nAction: ${JSON.stringify(act)}\nObservation: ${observation}`;
    }
    // Fallback (the echo provider emits no tool calls): pick a referenced type and semantic-search it.
    const ql = question.toLowerCase();
    const type = types.find((t) => ql.includes(t.toLowerCase())) ?? types[0];
    if (!type) return { answer: 'No object types are defined yet.', steps };
    const hits = await search(orgId, type, question, 5);
    steps.push({ tool: 'search', args: { objectType: type, query: question }, observation: JSON.stringify(hits).slice(0, 1500) });
    const answer = hits.length ? `Top matches in ${type}: ${hits.map((h) => `${h.primaryKey} (${h.score.toFixed(2)})`).join(', ')}.` : `No matches in ${type} — try indexing it first.`;
    return { answer, steps };
  }
```
  Add `agent` to the service's returned object.

- [ ] **Step 2: `routes.ts`** — add:
```ts
  fastify.post('/agent', { preHandler: requirePermission('aip:use') }, async (req, reply) => {
    const b = req.body as { question?: string };
    if (!b?.question) return reply.code(400).send({ error: 'question required' });
    try { return reply.send(await svc.agent(req.user!.orgId, b.question)); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });
```

- [ ] **Step 3: typecheck** `pnpm --filter @so/aip typecheck` → 0. Commit: `git add -A && git commit -m "feat(aip): tool-using agent over the ontology (read-only tools + echo fallback)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"`

---

## Task 3: E2E proves the agent path

**Files:** Modify the e2e suite (the same test Plan 55 extended — it already indexes `E2EFlight`)

- [ ] **Step 1** — after the Plan 55 index/search block, add:
```ts
    const ag = await app.inject({ method: 'POST', url: '/api/aip/agent', headers: auth, payload: { question: 'Which E2EFlight are Delayed?' } });
    expect(ag.statusCode).toBe(200);
    const aj = ag.json() as { answer: string; steps: Array<{ tool: string }> };
    expect(typeof aj.answer).toBe('string');
    expect(aj.answer.length).toBeGreaterThan(0);
    expect(aj.steps.some((s) => s.tool === 'search')).toBe(true);
```
(Match the e2e's real app-instance + auth-header variable names, as in Plan 55.)

- [ ] **Step 2: Run → PASS:** `pnpm --filter @so/e2e test` (timeout 180000).

---

## Task 4: API + UI (agent on the Ask surface)

**Files:** Modify `apps/web/src/api.ts`, `apps/web/src/views/AskView.tsx`, `apps/web/src/help.ts`; Create `apps/web/src/components/AgentTrace.tsx` (+ `.test.tsx`)

- [ ] **Step 1: `api.ts`** — add:
```ts
  aipAgent: (question: string) => req<{ answer: string; steps: Array<{ tool: string; args: unknown; observation: string }> }>('POST', '/aip/agent', { question }),
```

- [ ] **Step 2: `AgentTrace.tsx`**
```tsx
export type AgentStep = { tool: string; args: unknown; observation: string };
export function AgentTrace({ answer, steps }: { answer: string; steps: AgentStep[] }) {
  if (!answer && steps.length === 0) return null;
  return (
    <div>
      {answer ? <div className="card" style={{ background: 'var(--accent-soft)', marginTop: 10 }}><strong>Answer:</strong> {answer}</div> : null}
      {steps.length ? (
        <details style={{ marginTop: 10 }}>
          <summary className="muted">{steps.length} step{steps.length === 1 ? '' : 's'} taken</summary>
          <ol>{steps.map((s, i) => (<li key={i}><code>{s.tool}</code>(<span className="muted">{JSON.stringify(s.args)}</span>) → <span className="muted">{s.observation.slice(0, 200)}</span></li>))}</ol>
        </details>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: `AgentTrace.test.tsx`**
```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { AgentTrace } from './AgentTrace';
describe('AgentTrace', () => {
  it('shows the answer and the tool steps', () => {
    render(<AgentTrace answer="Top matches in Flight: BA1 (0.90)." steps={[{ tool: 'search', args: { query: 'x' }, observation: '[...]' }]} />);
    expect(screen.getByText(/Top matches in Flight/)).toBeInTheDocument();
    expect(screen.getByText('search')).toBeInTheDocument();
  });
  it('renders nothing when empty', () => {
    const { container } = render(<AgentTrace answer="" steps={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 4: `AskView.tsx`** — add an "Ask the agent" card (above or below the semantic-search card). State + handler:
```tsx
const [aq, setAq] = useState('');
const [agentRes, setAgentRes] = useState<{ answer: string; steps: AgentStep[] } | null>(null);
const [arun, setArun] = useState(false);
async function runAgent() { setArun(true); try { setAgentRes(await api.aipAgent(aq)); } catch (e) { setAgentRes({ answer: (e as Error).message, steps: [] }); } finally { setArun(false); } }
```
```tsx
<div className="card" style={{ marginTop: 18 }}>
  <h3>Ask the agent</h3>
  <p className="muted">Ask a question; the agent picks tools (search, sample, aggregate) over your ontology and shows its work.</p>
  <div style={{ display: 'flex', gap: 8 }}>
    <input aria-label="agent question" value={aq} onChange={(e) => setAq(e.target.value)} placeholder="Which flights are delayed?" style={{ flex: 1 }} onKeyDown={(e) => { if (e.key === 'Enter') runAgent(); }} />
    <button onClick={runAgent} disabled={arun || !aq.trim()}>{arun ? 'Thinking…' : 'Run'}</button>
  </div>
  {agentRes ? <AgentTrace answer={agentRes.answer} steps={agentRes.steps} /> : null}
</div>
```
(Import `AgentTrace`, `type AgentStep`, hooks. Match AskView's existing structure.)

- [ ] **Step 5: `help.ts`** — update `'console:ask'` to add: `'Ask the agent a question — it chooses tools over your ontology and shows the steps it took.'`

- [ ] **Step 6: Verify:** `pnpm --filter @so/web typecheck` (0); `pnpm --filter @so/web test` (all pass incl. AgentTrace); `pnpm --filter @so/web build`. No unused imports; no `eslint-disable react-hooks/exhaustive-deps`.
- [ ] **Step 7: Commit:** `git add -A && git commit -m "feat(web): agent panel (answer + tool trace) on the Ask surface" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"`

---

## Task 5: Full verification + merge (GATED)
- [ ] Run:
```bash
cd /Users/sumitagrawal/CODE/sumit/SoftwareOntology
pnpm run infra:up && pnpm run infra:seed
pnpm typecheck; tc=$?
pnpm lint; lint=$?
pnpm test >/tmp/p56.log 2>&1; t=$?
grep -E "Tests +[0-9]+ (passed|failed)" /tmp/p56.log | tail -1
echo "tc=$tc lint=$lint t=$t"
if [ $tc -eq 0 ] && [ $lint -eq 0 ] && [ $t -eq 0 ]; then git checkout main && git merge --ff-only phase56/aip-agent && echo MERGED; else echo "NOT MERGING"; fi
```
(Flaky env: re-run once on mass ~60000ms timeouts / `ERR_IPC_CHANNEL_CLOSED` after confirming `docker info`.)

---

## Self-review
- **Agent** — ReAct loop over read-only ontology tools (listTypes/search/sample/aggregate); `{answer, steps}` trace. ✓
- **Works under echo** — `parseAction` returns null for echo output → deterministic semantic-search fallback answers + records a step. ✓
- **Real-LLM ready** — with `AIP_PROVIDER=http`, the loop parses real tool calls and iterates. ✓
- **Safe** — no autonomous writes; action *execution* as an agent tool is deferred/flagged. ✓
- **Testable** — `parseAction` unit tests + `AgentTrace` test + e2e agent assertion (search step + non-empty answer). ✓
- **No new deps** — tools reuse the `ontology` handle + Plan 55 `search`; aip stays `dependsOn ['ontology','auth']`. **This completes Pillar 2.**
