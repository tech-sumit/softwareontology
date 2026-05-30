import { ObjectsTable } from './ObjectsTable';
import type { AppDefinition, AppWidget } from '../api';

export interface AppRuntimeData {
  objects: Record<string, Record<string, unknown>[]>;
  onRunAction: (action: string) => void;
}

function WidgetView({ widget, data }: { widget: AppWidget; data: AppRuntimeData }) {
  const title = widget.title ?? widget.type;
  if (widget.type === 'object-table') {
    const ot = String(widget.config.objectType ?? '');
    const rows = data.objects[ot] ?? [];
    const columns = rows.length > 0 ? Object.keys(rows[0]!) : [];
    return <div className="card"><h3>{title}</h3><ObjectsTable columns={columns} rows={rows} pk={columns[0] ?? ''} onSelect={() => {}} /></div>;
  }
  if (widget.type === 'metric') {
    const ot = String(widget.config.objectType ?? '');
    const count = (data.objects[ot] ?? []).length;
    return <div className="card"><h3>{title}</h3><div style={{ fontSize: 32, fontWeight: 700 }}>{count}</div></div>;
  }
  if (widget.type === 'action-button') {
    const action = String(widget.config.action ?? '');
    return <div className="card"><button onClick={() => data.onRunAction(action)}>{title}</button></div>;
  }
  return <div className="card">Unknown widget: {widget.type}</div>;
}

export function AppRuntime({ definition, data }: { definition: AppDefinition; data: AppRuntimeData }) {
  return <div className="app-runtime">{definition.widgets.map((w) => <WidgetView key={w.id} widget={w} data={data} />)}</div>;
}
