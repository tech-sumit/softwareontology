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
