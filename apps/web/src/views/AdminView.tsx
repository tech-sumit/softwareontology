import { useEffect, useState } from 'react';
import { api } from '../api';
import { UsersTable } from '../components/UsersTable';

export function AdminView() {
  const [users, setUsers] = useState<Array<{ id: string; email: string; roles: string[] }>>([]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');

  async function load() { try { setUsers((await api.listUsers()).users); } catch (e) { setErr((e as Error).message); } }
  useEffect(() => { void load(); }, []);

  async function add() {
    setErr('');
    try { await api.createUser(email, password); setEmail(''); setPassword(''); await load(); }
    catch (e) { setErr((e as Error).message); }
  }

  return (
    <div className="row">
      <div className="main"><UsersTable users={users} /></div>
      <div className="detail">
        <h3 style={{ marginTop: 0 }}>New user</h3>
        <label htmlFor="ne">Email</label>
        <input id="ne" value={email} onChange={(e) => setEmail(e.target.value)} />
        <label htmlFor="np">Password</label>
        <input id="np" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <div style={{ marginTop: 10 }}><button onClick={add}>Create user</button></div>
        {err ? <div className="err">{err}</div> : null}
      </div>
    </div>
  );
}
