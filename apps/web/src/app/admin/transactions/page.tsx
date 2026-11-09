'use client';

import { useEffect, useState } from 'react';
import { Alert, errorMessage, PageHeader, Spinner } from '@/components/ui';
import { api, formatMoney } from '@/lib/api';

export default function LedgerPage() {
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setRows(null);
    api(`/admin/transactions${status ? `?status=${status}` : ''}`).then(setRows).catch((e) => setError(errorMessage(e)));
  }, [status]);

  return (
    <>
      <PageHeader
        title="Ledger"
        subtitle="Latest 200 journal entries."
        action={
          <select aria-label="Filter by status" className="input w-40" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option value="completed">Completed</option>
            <option value="held">Held</option>
            <option value="rejected">Rejected</option>
          </select>
        }
      />
      {error && <Alert>{error}</Alert>}
      {!rows ? (
        <Spinner />
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[46rem] text-sm">
            <thead className="bg-muted text-left text-sub">
              <tr>
                <th className="px-4 py-2.5 font-medium">When</th>
                <th className="px-4 py-2.5 font-medium">Type</th>
                <th className="px-4 py-2.5 font-medium">Description</th>
                <th className="px-4 py-2.5 font-medium">By</th>
                <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                <th className="px-4 py-2.5 text-right font-medium">Risk</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="whitespace-nowrap px-4 py-2 text-sub">{new Date(r.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-2">{r.kind}</td>
                  <td className="max-w-56 truncate px-4 py-2">{r.description}</td>
                  <td className="px-4 py-2 text-sub">{r.initiator ?? 'system'}</td>
                  <td className="tabular px-4 py-2 text-right">{r.amount ? formatMoney(r.amount, r.currency) : '—'}</td>
                  <td className="tabular px-4 py-2 text-right">{r.fraudScore != null ? Math.round(r.fraudScore * 100) : '—'}</td>
                  <td className="px-4 py-2">
                    <span className={`badge ${r.status === 'completed' ? 'bg-good/15 text-good' : r.status === 'held' ? 'bg-warn/15 text-warn' : 'bg-bad/15 text-bad'}`}>{r.status}</span>
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
