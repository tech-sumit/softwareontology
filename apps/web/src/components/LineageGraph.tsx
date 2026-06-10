export type LineageData = {
  objectType: string;
  dataset?: { id: string; name: string } | null;
  actions: string[];
  links: Array<{ apiName: string; toObjectType: string }>;
};

const ROW = 24; // vertical gap between rows
const NODE_H = 34;
const NODE_W = 180;
const DS_X = 20;
const OT_X = 290;
const OUT_X = 560;

function nodeYs(count: number, totalH: number): number[] {
  if (count === 0) return [];
  const block = count * NODE_H + (count - 1) * ROW;
  const top = Math.max(10, (totalH - block) / 2);
  return Array.from({ length: count }, (_, i) => top + i * (NODE_H + ROW));
}

export function LineageGraph({ data, onOpenType }: { data: LineageData; onOpenType?: (apiName: string) => void }) {
  const nActions = Math.max(data.actions.length, 1);
  const nLinks = Math.max(data.links.length, 1);
  const rightRows = nActions + nLinks;
  const height = Math.max(140, rightRows * (NODE_H + ROW) + 40);

  const actionBlockH = nActions * (NODE_H + ROW);
  const actionYs = nodeYs(nActions, actionBlockH);
  const linkYs = nodeYs(nLinks, height - actionBlockH).map((y) => y + actionBlockH);
  const midY = height / 2 - NODE_H / 2;

  const arrow = (x1: number, y1: number, x2: number, y2: number, key: string) => (
    <line key={key} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--muted)" strokeWidth={1.2} markerEnd="url(#lg-arrow)" />
  );

  return (
    <svg width="100%" viewBox={`0 0 760 ${height}`} role="img" aria-label={`lineage graph for ${data.objectType}`} style={{ display: 'block' }}>
      <defs>
        <marker id="lg-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" fill="var(--muted)" />
        </marker>
      </defs>

      {/* dataset node (left) */}
      <g>
        <rect x={DS_X} y={midY} width={NODE_W} height={NODE_H} rx={8} fill="var(--accent-soft)" stroke="var(--accent)" />
        <text x={DS_X + NODE_W / 2} y={midY + NODE_H / 2 + 4} textAnchor="middle" fontSize={12} fill="var(--ink)">
          {data.dataset?.name ?? '—'}
        </text>
      </g>
      {arrow(DS_X + NODE_W, midY + NODE_H / 2, OT_X - 4, midY + NODE_H / 2, 'ds-ot')}

      {/* object type node (center) */}
      <g>
        <rect x={OT_X} y={midY} width={NODE_W} height={NODE_H} rx={8} fill="var(--accent)" />
        <text x={OT_X + NODE_W / 2} y={midY + NODE_H / 2 + 4} textAnchor="middle" fontSize={12} fontWeight={600} fill="#fff">
          {data.objectType}
        </text>
      </g>

      {/* actions (top-right) */}
      {data.actions.length === 0 ? (
        <text x={OUT_X + 8} y={actionYs[0]! + NODE_H / 2 + 4} fontSize={12} fill="var(--muted)">no actions</text>
      ) : (
        data.actions.map((a, i) => (
          <g key={`act-${a}`}>
            {arrow(OT_X + NODE_W, midY + NODE_H / 2, OUT_X - 4, actionYs[i]! + NODE_H / 2, `act-line-${a}`)}
            <rect x={OUT_X} y={actionYs[i]} width={NODE_W} height={NODE_H} rx={8} fill="var(--ok-bg)" stroke="var(--line)" />
            <text x={OUT_X + NODE_W / 2} y={actionYs[i]! + NODE_H / 2 + 4} textAnchor="middle" fontSize={12} fill="var(--ink)">{a}</text>
          </g>
        ))
      )}

      {/* linked types (bottom-right) */}
      {data.links.length === 0 ? (
        <text x={OUT_X + 8} y={linkYs[0]! + NODE_H / 2 + 4} fontSize={12} fill="var(--muted)">no links</text>
      ) : (
        data.links.map((l, i) => (
          <g
            key={`lnk-${l.apiName}`}
            role="button"
            aria-label={`open ${l.toObjectType}`}
            style={{ cursor: 'pointer' }}
            onClick={() => onOpenType?.(l.toObjectType)}
          >
            {arrow(OT_X + NODE_W, midY + NODE_H / 2, OUT_X - 4, linkYs[i]! + NODE_H / 2, `lnk-line-${l.apiName}`)}
            <rect x={OUT_X} y={linkYs[i]} width={NODE_W} height={NODE_H} rx={8} fill="var(--panel)" stroke="var(--line)" />
            <text x={OUT_X + NODE_W / 2} y={linkYs[i]! + NODE_H / 2 - 2} textAnchor="middle" fontSize={12} fill="var(--ink)">{l.toObjectType}</text>
            <text x={OUT_X + NODE_W / 2} y={linkYs[i]! + NODE_H / 2 + 11} textAnchor="middle" fontSize={10} fill="var(--muted)">{l.apiName}</text>
          </g>
        ))
      )}
    </svg>
  );
}
