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
