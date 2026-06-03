import { useState } from 'react';
export function HelpPanel({ title, steps }: { title: string; steps: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={open ? 'help open' : 'help'}>
      <button className="help-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="help-i">?</span> How to use {title}
        <span className="help-chev">{open ? '▲' : '▼'}</span>
      </button>
      {open ? <ol className="help-steps">{steps.map((s, i) => <li key={i}>{s}</li>)}</ol> : null}
    </div>
  );
}
