import { useEffect, useState } from 'react';
import { api } from '../api';
import { UsersTable } from '../components/UsersTable';
import { RolesTable } from '../components/RolesTable';

type UserRow = { id: string; email: string; roles: string[] };
type RoleRow = { id: string; name: string; permissions: string[] };

export function AdminView() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [userRoleNames, setUserRoleNames] = useState<string[]>([]);

  const [roleName, setRoleName] = useState('');
  const [rolePerms, setRolePerms] = useState<string[]>([]);

  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  async function load() {
    try {
      const [u, r, p] = await Promise.all([api.listUsers(), api.listRoles(), api.listPermissions()]);
      setUsers(u.users);
      setRoles(r.roles);
      setPermissions(p.permissions);
    } catch (e) { setErr((e as Error).message); }
  }
  useEffect(() => { void load(); }, []);

  function toggle(list: string[], value: string): string[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  async function addUser() {
    setErr(''); setMsg('');
    try {
      await api.createUser(email, password, userRoleNames);
      setEmail(''); setPassword(''); setUserRoleNames([]);
      await load();
      setMsg('User created.');
    } catch (e) { setErr((e as Error).message); }
  }

  async function addRole() {
    setErr(''); setMsg('');
    try {
      await api.createRole(roleName, rolePerms);
      setRoleName(''); setRolePerms([]);
      await load();
      setMsg('Role created.');
    } catch (e) { setErr((e as Error).message); }
  }

  return (
    <div className="row">
      <div className="main">
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>Users</h3>
          <UsersTable users={users} />
        </div>
        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>Roles</h3>
          <RolesTable roles={roles} />
        </div>
      </div>
      <div className="detail">
        <h3 style={{ marginTop: 0 }}>New user</h3>
        <div className="field">
          <label htmlFor="ne">Email</label>
          <input id="ne" aria-label="new user email" value={email} placeholder="user@company.com" onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="np">Password</label>
          <input id="np" aria-label="new user password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div className="field">
          <label>Roles</label>
          <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 8, padding: 8 }}>
            {roles.length === 0
              ? <p className="muted" style={{ margin: 0 }}>No roles yet.</p>
              : roles.map((r) => (
                  <label key={r.id} style={{ display: 'block', fontWeight: 'normal' }}>
                    <input
                      type="checkbox"
                      checked={userRoleNames.includes(r.name)}
                      onChange={() => setUserRoleNames((prev) => toggle(prev, r.name))}
                    /> {r.name}
                  </label>
                ))}
          </div>
        </div>
        <div style={{ marginTop: 10 }}><button onClick={addUser}>Create user</button></div>

        <h3 style={{ marginTop: 24 }}>New role</h3>
        <div className="field">
          <label htmlFor="nr">Name</label>
          <input id="nr" aria-label="new role name" value={roleName} placeholder="e.g. analyst" onChange={(e) => setRoleName(e.target.value)} />
        </div>
        <div className="field">
          <label>Permissions</label>
          <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 8, padding: 8 }}>
            {permissions.length === 0
              ? <p className="muted" style={{ margin: 0 }}>No permissions available.</p>
              : permissions.map((p) => (
                  <label key={p} style={{ display: 'block', fontWeight: 'normal' }}>
                    <input
                      type="checkbox"
                      checked={rolePerms.includes(p)}
                      onChange={() => setRolePerms((prev) => toggle(prev, p))}
                    /> {p}
                  </label>
                ))}
          </div>
        </div>
        <div style={{ marginTop: 10 }}><button onClick={addRole}>Create role</button></div>

        {msg ? <div style={{ color: '#3fb950', marginTop: 10 }}>{msg}</div> : null}
        {err ? <div className="err">{err}</div> : null}
      </div>
    </div>
  );
}
