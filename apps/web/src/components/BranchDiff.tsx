export type Edit = { objectType: string; primaryKey: string; property: string; value: string | null };
export type Create = { objectType: string; primaryKey: string };
export function BranchDiff({ edits, creates }: { edits: Edit[]; creates: Create[] }) {
  if (edits.length === 0 && creates.length === 0) return <p className="muted">No changes on this branch yet.</p>;
  return (
    <div>
      {edits.length ? (
        <>
          <h4>Edits ({edits.length})</h4>
          <table><thead><tr><th>Type</th><th>Key</th><th>Property</th><th>New value</th></tr></thead>
            <tbody>{edits.map((e, i) => (<tr key={i}><td>{e.objectType}</td><td>{e.primaryKey}</td><td>{e.property}</td><td>{e.value}</td></tr>))}</tbody>
          </table>
        </>
      ) : null}
      {creates.length ? (
        <>
          <h4>New objects ({creates.length})</h4>
          <ul>{creates.map((c, i) => (<li key={i}>{c.objectType}: {c.primaryKey}</li>))}</ul>
        </>
      ) : null}
    </div>
  );
}
