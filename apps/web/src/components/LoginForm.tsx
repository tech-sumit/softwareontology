import { useState } from 'react';

export function LoginForm({ onSubmit, error, onSso }: { onSubmit: (email: string, password: string) => void; error?: string; onSso?: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  return (
    <form className="login-card card pad" onSubmit={(e) => { e.preventDefault(); onSubmit(email, password); }}>
      <div className="login-brand">
        <div className="login-logo">S</div>
        <div>
          <strong>SoftwareOntology</strong>
          <div className="muted" style={{ fontSize: 12 }}>Sign in to your workspace</div>
        </div>
      </div>
      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" value={email} placeholder="you@company.com" onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <button type="submit" style={{ width: '100%' }}>Sign in</button>
      {onSso ? <button type="button" className="sec" style={{ width: '100%', marginTop: 8 }} onClick={onSso}>Sign in with SSO</button> : null}
      {error ? <div className="err" role="alert">{error}</div> : null}
    </form>
  );
}
