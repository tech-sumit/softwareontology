export function ObjectDetail({ object, actions, onRun }: {
  object: Record<string, unknown>;
  actions: Array<{ apiName: string; kind: string }>;
  onRun: (apiName: string) => void;
}) {
  const keys = Object.keys(object);
  return (
    <div>
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {keys.map((k) => (
          <div key={k} style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
            <div className="k">{k}</div>
            <div className="v">{object[k] === null || object[k] === undefined ? '—' : String(object[k])}</div>
          </div>
        ))}
      </div>
      {actions.length > 0 ? (
        <div style={{ marginTop: 14 }}>
          <h3>Actions</h3>
          <div className="qa">{actions.map((a) => <button key={a.apiName} onClick={() => onRun(a.apiName)}>{a.apiName}</button>)}</div>
        </div>
      ) : null}
    </div>
  );
}
