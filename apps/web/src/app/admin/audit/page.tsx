'use client';

import { useEffect, useState } from 'react';
import { Alert, errorMessage, PageHeader, Spinner } from '@/components/ui';
import { api } from '@/lib/api';

export default function AuditPage() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api('/admin/audit-logs').then(setRows).catch((e) => setError(errorMessage(e)));
  }, []);

  return (
    <>
      <PageHeader title="Audit log" subtitle="Append-only record of security and money events. Entries cannot be edited or deleted." />
      {error && <Alert>{error}</Alert>}
      {!rows ? (
        <Spinner />
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="bg-muted text-left text-sub">
              <tr>
                <th className="px-4 py-2.5 font-medium">When</th>
                <th className="px-4 py-2.5 font-medium">Action</th>
                <th className="px-4 py-2.5 font-medium">Actor</th>
                <th className="px-4 py-2.5 font-medium">IP</th>
                <th className="px-4 py-2.5 font-medium">Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line align-top">
                  <td className="whitespace-nowrap px-4 py-2 text-sub">{new Date(r.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-2 font-mono text-xs">{r.action}</td>
                  <td className="px-4 py-2">{r.actor ?? '—'}</td>
                  <td className="px-4 py-2 text-sub">{r.ip ?? '—'}</td>
                  <td className="max-w-72 truncate px-4 py-2 font-mono text-xs text-faint" title={JSON.stringify(r.metadata)}>{Object.keys(r.metadata ?? {}).length ? JSON.stringify(r.metadata) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
