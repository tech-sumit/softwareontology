import type { ModuleContext } from '@so/sdk';
import { createOntologyService } from '@so/ontology';
import { hashEmbed, cosine } from './embed.js';

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

  async function ask(orgId: string, objectType: string, question: string): Promise<string> {
    const objects = await ontology.resolveObjects(orgId, objectType, { limit: 50 });
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

  return { complete, ask, indexObjectType, search };
}
