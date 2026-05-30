import type { ModuleContext } from '@so/sdk';
import { createOntologyService } from '@so/ontology';

interface Provider { complete(prompt: string): Promise<string>; }

function echoProvider(): Provider {
  return { async complete(prompt: string): Promise<string> { return `echo: ${prompt.slice(0, 2000)}`; } };
}

function httpProvider(endpoint: string): Provider {
  return {
    async complete(prompt: string): Promise<string> {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt }) });
      if (!res.ok) throw new Error(`AIP provider error: ${res.status}`);
      const data = (await res.json()) as { completion?: string };
      return data.completion ?? '';
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

  return { complete, ask };
}
