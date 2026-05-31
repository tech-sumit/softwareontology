export function PlaceholderView({ title }: { title: string }) {
  return (
    <div className="card">
      <h2>{title}</h2>
      <p style={{ color: '#8a929c' }}>This surface's backend API is already built and tested — its UI is being wired up next.</p>
    </div>
  );
}
