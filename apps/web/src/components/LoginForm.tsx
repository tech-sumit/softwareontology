import { useState } from 'react';

export function LoginForm({ onSubmit, error, onSso }: { onSubmit: (email: string, password: string) => void; error?: string; onSso?: () => void }) {
  const [email, setEmail] = useState('admin@example.com');
  const [password, setPassword] = useState('admin');
  return (
    <form className="card" onSubmit={(e) => { e.preventDefault(); onSubmit(email, password); }}>
      <h2>Sign in</h2>
      <label htmlFor="email">Email</label>
      <input id="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <label htmlFor="password">Password</label>
      <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <div style={{ marginTop: 12 }}><button type="submit">Sign in</button></div>
      {onSso ? <div style={{ marginTop: 8 }}><button type="button" className="sec" onClick={onSso}>Sign in with SSO</button></div> : null}
      {error ? <div className="err" role="alert">{error}</div> : null}
    </form>
  );
}
