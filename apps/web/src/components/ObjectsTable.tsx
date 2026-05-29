export function ObjectsTable({
  columns, rows, pk, selected, onSelect,
}: {
  columns: string[];
  rows: Record<string, unknown>[];
  pk: string;
  selected?: string | undefined;
  onSelect: (id: string) => void;
}) {
  if (rows.length === 0) return <p style={{ color: '#8a929c' }}>No objects.</p>;
  return (
    <table>
      <thead><tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
      <tbody>
        {rows.map((r) => {
          const id = String(r[pk]);
          return (
            <tr key={id} className={selected === id ? 'sel' : ''} onClick={() => onSelect(id)} style={{ cursor: 'pointer' }}>
              {columns.map((c) => <td key={c}>{r[c] === null || r[c] === undefined ? '' : String(r[c])}</td>)}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
