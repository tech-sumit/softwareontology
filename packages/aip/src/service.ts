import type { ModuleContext } from '@so/sdk';
import { createOntologyService, type Principal } from '@so/ontology';
import { hashEmbed, cosine } from './embed.js';
import { parseAction } from './agent.js';

interface Provider {
  complete(prompt: string): Promise<string>;
  embeddings(text: string): Promise<number[]>;
}

function echoProvider(): Provider {
  return {
    async complete(prompt: string): Promise<string> { return `echo: ${prompt.slice(0, 2000)}`; },
    async embeddings(text: string): Promise<number[]> { return hashEmbed(text); },
  };
}

function httpProvider(endpoint: string): Provider {
  return {
    async complete(prompt: string): Promise<string> {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt }) });
      if (!res.ok) throw new Error(`AIP provider error: ${res.status}`);
      const data = (await res.json()) as { completion?: string };
      return data.completion ?? '';
    },
    async embeddings(text: string): Promise<number[]> {
      const url = `${endpoint.replace(/\/$/, '')}/embeddings`;
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: text }) });
      if (!res.ok) throw new Error(`AIP embeddings error: ${res.status}`);
      const data = (await res.json()) as { embedding?: number[] };
      return data.embedding ?? [];
    },
  };
}

export function createAipService(ctx: ModuleContext) {
  const ontology = createOntologyService(ctx);

  function provider(): Provider {
    const kind = ctx.config.get('AIP_PROVIDER') ?? 'echo';
    if (kind === 'http') return httpProvider(ctx.config.require('AIP_ENDPOINT'));
    return echoProvider();
  }

  async function complete(prompt: string): Promise<string> {
    return provider().complete(prompt);
  }

  async function ask(orgId: string, objectType: string, question: string, principal?: Principal): Promise<string> {
    const objects = await ontology.resolveObjects(orgId, objectType, { limit: 50, principal });
    const prompt =
      `You are analyzing ${objectType} objects.\n` +
      `Data: ${JSON.stringify(objects).slice(0, 4000)}\n` +
      `Question: ${question}\nAnswer:`;
    return provider().complete(prompt);
  }

  function docFor(obj: Record<string, unknown>, stringProps: string[], pk: string): string {
    const parts = stringProps.map((p) => `${p}: ${obj[p] ?? ''}`).filter((s) => !s.endsWith(': '));
    return parts.join(' · ') || String(obj[pk] ?? '');
  }
  async function indexObjectType(orgId: string, objectType: string, principal?: Principal): Promise<{ indexed: number }> {
    const ot = await ontology.getObjectType(orgId, objectType);
    if (!ot) throw new Error('unknown object type');
    const stringProps = ot.properties.filter((p) => p.type === 'string').map((p) => p.apiName);
    const pk = ot.primaryKey;
    const objects = await ontology.resolveObjects(orgId, objectType, { limit: 1000, principal });
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
  async function search(orgId: string, objectType: string, query: string, k = 10, principal?: Principal): Promise<Array<{ primaryKey: string; score: number; doc: string }>> {
    // search reads the precomputed embeddings table, bypassing resolveObjects; when a
    // principal is supplied, gate it through the same clearance enforcement so markings
    // can't be bypassed via semantic search.
    if (principal) await ontology.resolveObjects(orgId, objectType, { limit: 1, principal });
    const qv = await provider().embeddings(query);
    const rows = await ctx.db.query<{ primary_key: string; doc: string; vector: number[] }>(
      `SELECT primary_key, doc, vector FROM aip_embeddings WHERE org_id = $1 AND object_type = $2`, [orgId, objectType]);
    const scored = rows.map((r) => ({ primaryKey: r.primary_key, doc: r.doc, score: cosine(qv, Array.isArray(r.vector) ? r.vector : []) }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, Math.max(1, Math.min(k, 100)));
  }

  async function aggregateLocal(orgId: string, objectType: string, groupBy: string, principal?: Principal): Promise<Array<{ group: string; count: number }>> {
    const objs = await ontology.resolveObjects(orgId, objectType, { limit: 1000, principal });
    const m = new Map<string, number>();
    for (const o of objs) { const g = String(o[groupBy] ?? '∅'); m.set(g, (m.get(g) ?? 0) + 1); }
    return [...m.entries()].map(([group, count]) => ({ group, count })).sort((a, b) => b.count - a.count);
  }
  const tools: Array<{ name: string; description: string; run: (orgId: string, a: Record<string, unknown>, principal?: Principal) => Promise<unknown> }> = [
    { name: 'listTypes', description: 'List object type apiNames. args: {}', run: async (orgId) => (await ontology.listObjectTypes(orgId)).map((t) => t.apiName) },
    { name: 'search', description: 'Semantic search within a type. args: {objectType, query}', run: async (orgId, a, principal) => search(orgId, String(a.objectType), String(a.query), 5, principal) },
    { name: 'sample', description: 'Return some objects of a type. args: {objectType, limit}', run: async (orgId, a, principal) => ontology.resolveObjects(orgId, String(a.objectType), { limit: Math.min(Number(a.limit) || 10, 50), principal }) },
    { name: 'aggregate', description: 'Group-by counts. args: {objectType, groupBy}', run: async (orgId, a, principal) => aggregateLocal(orgId, String(a.objectType), String(a.groupBy), principal) },
  ];
  async function agent(orgId: string, question: string, opts?: { maxSteps?: number }, principal?: Principal): Promise<{ answer: string; steps: Array<{ tool: string; args: unknown; observation: string }> }> {
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
      else { try { observation = JSON.stringify(await tool.run(orgId, act.args, principal)).slice(0, 1500); } catch (e) { observation = `error: ${(e as Error).message}`; } }
      steps.push({ tool: act.tool, args: act.args, observation });
      history += `\nAction: ${JSON.stringify(act)}\nObservation: ${observation}`;
    }
    // Fallback (the echo provider emits no tool calls): pick a referenced type and semantic-search it.
    const ql = question.toLowerCase();
    const type = types.find((t) => ql.includes(t.toLowerCase())) ?? types[0];
    if (!type) return { answer: 'No object types are defined yet.', steps };
    const hits = await search(orgId, type, question, 5, principal);
    steps.push({ tool: 'search', args: { objectType: type, query: question }, observation: JSON.stringify(hits).slice(0, 1500) });
    const answer = hits.length ? `Top matches in ${type}: ${hits.map((h) => `${h.primaryKey} (${h.score.toFixed(2)})`).join(', ')}.` : `No matches in ${type} — try indexing it first.`;
    return { answer, steps };
  }

  return { complete, ask, indexObjectType, search, agent };
}
