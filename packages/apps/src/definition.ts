export interface AppWidget { id: string; type: string; title?: string; config: Record<string, unknown>; }
export interface AppDefinition { widgets: AppWidget[]; }

const REQUIRED_CONFIG: Record<string, string[]> = {
  'object-table': ['objectType'],
  'action-button': ['action'],
  'metric': ['objectType'],
};

export function validateDefinition(input: unknown): AppDefinition {
  if (!input || typeof input !== 'object') throw new Error('definition must be an object');
  const widgets = (input as { widgets?: unknown }).widgets;
  if (!Array.isArray(widgets)) throw new Error('definition.widgets must be an array');
  const out: AppWidget[] = [];
  for (const w of widgets) {
    if (!w || typeof w !== 'object') throw new Error('each widget must be an object');
    const type = (w as { type?: unknown }).type;
    if (typeof type !== 'string' || !(type in REQUIRED_CONFIG)) throw new Error(`unknown widget type: ${String(type)}`);
    const id = (w as { id?: unknown }).id;
    if (typeof id !== 'string' || !id) throw new Error('each widget needs a string id');
    const config = ((w as { config?: unknown }).config ?? {}) as Record<string, unknown>;
    if (typeof config !== 'object') throw new Error('widget config must be an object');
    for (const key of REQUIRED_CONFIG[type]!) {
      if (!config[key]) throw new Error(`widget '${type}' requires config.${key}`);
    }
    const title = (w as { title?: unknown }).title;
    const widget: AppWidget = { id, type, config };
    if (typeof title === 'string') widget.title = title;
    out.push(widget);
  }
  return { widgets: out };
}
