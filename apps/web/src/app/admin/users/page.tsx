'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, errorMessage, PageHeader, Spinner } from '@/components/ui';
import { api } from '@/lib/api';

export default function UsersPage() {
  const [q, setQ] = useState('');
  const [users, setUsers] = useState<any[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api(`/admin/users${q ? `?q=${encodeURIComponent(q)}` : ''}`).then(setUsers).catch((e) => setError(errorMessage(e)));
  }, [q]);
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const update = async (id: string, path: string, body: object) => {
    try {
      await api(`/admin/users/${id}/${path}`, { method: 'PATCH', body });
      load();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <>
      <PageHeader title="Users" action={<input aria-label="Search users" className="input w-64" placeholder="Search name or email" value={q} onChange={(e) => setQ(e.target.value)} />} />
      {error && <Alert>{error}</Alert>}
      {!users ? (
        <Spinner />
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[44rem] text-sm">
            <thead className="bg-muted text-left text-sub">
              <tr>
                <th className="px-4 py-2.5 font-medium">User</th>
                <th className="px-4 py-2.5 font-medium">KYC</th>
                <th className="px-4 py-2.5 font-medium">MFA</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Joined</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-line">
                  <td className="px-4 py-2.5">
                    <p className="font-medium">{u.fullName} {u.role === 'admin' && <span className="badge bg-brand/10 text-brand">admin</span>}</p>
                    <p className="text-xs text-faint">{u.email}</p>
                  </td>
                  <td className="px-4 py-2.5">
                    <select aria-label={`KYC level for ${u.email}`} className="input w-20 py-1" value={u.kycLevel} onChange={(e) => update(u.id, 'kyc', { level: Number(e.target.value) })}>
                      {[0, 1, 2].map((l) => <option key={l} value={l}>{l}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-2.5">{u.mfaEnabled ? <span className="text-good">● On</span> : <span className="text-faint">Off</span>}</td>
                  <td className="px-4 py-2.5">
                    <span className={`badge ${u.status === 'active' ? 'bg-good/15 text-good' : 'bg-bad/15 text-bad'}`}>{u.status}</span>
                  </td>
                  <td className="px-4 py-2.5 text-sub">{new Date(u.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-2.5 text-right">
                    {u.role !== 'admin' && (
                      <button className={u.status === 'active' ? 'btn-ghost px-3 py-1 text-bad' : 'btn-ghost px-3 py-1'} onClick={() => update(u.id, 'status', { status: u.status === 'active' ? 'frozen' : 'active' })}>
                        {u.status === 'active' ? 'Freeze' : 'Unfreeze'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
