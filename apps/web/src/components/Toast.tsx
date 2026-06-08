export function Toast({ message, kind = 'ok', onClose }: { message: string; kind?: 'ok' | 'err'; onClose: () => void }) {
  return (
    <div className={kind === 'err' ? 'toast toast-err' : 'toast'} role="status">
      <span>{message}</span>
      <button className="toast-x" aria-label="dismiss" onClick={onClose}>×</button>
    </div>
  );
}
