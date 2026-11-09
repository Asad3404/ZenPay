'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, Empty, errorMessage, PageHeader, Spinner } from '@/components/ui';
import { api, formatMoney } from '@/lib/api';

const STATUSES = ['open', 'approved', 'rejected', 'logged'];

const featureLabels: Record<string, string> = {
  amount_usd: 'Amount (USD)',
  avg_amount_90d_usd: '90-day average (USD)',
  account_age_days: 'Account age (days)',
  tx_count_1h: 'Payments, last hour',
  tx_count_24h: 'Payments, last 24h',
  is_new_recipient: 'New recipient',
  is_known_device: 'Known device',
  kyc_level: 'KYC level',
  hour_of_day: 'Hour (UTC)',
};

export default function FraudPage() {
  const [status, setStatus] = useState('open');
  const [cases, setCases] = useState<any[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setCases(null);
    api(`/admin/fraud-cases?status=${status}`).then(setCases).catch((e) => setError(errorMessage(e)));
  }, [status]);
  useEffect(load, [load]);

  const act = async (id: string, action: 'approve' | 'reject') => {
    setBusy(id);
    try {
      await api(`/admin/fraud-cases/${id}/${action}`, { body: {} });
      load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Fraud review"
        subtitle="Payments the risk engine held, blocked or flagged."
        action={
          <div className="inline-grid grid-cols-4 rounded-xl bg-muted p-1 text-sm font-medium" role="tablist">
            {STATUSES.map((s) => (
              <button key={s} role="tab" aria-selected={status === s} onClick={() => setStatus(s)} className={`rounded-lg px-3 py-1.5 capitalize ${status === s ? 'bg-surface shadow-sm' : 'text-sub'}`}>{s}</button>
            ))}
          </div>
        }
      />
      {error && <Alert>{error}</Alert>}
      {!cases ? (
        <Spinner />
      ) : cases.length === 0 ? (
        <Empty>No {status} cases.</Empty>
      ) : (
        <div className="space-y-4">
          {cases.map((c) => {
            const pct = Math.round(c.score * 100);
            const tone = c.score >= 0.92 ? 'text-bad' : c.score >= 0.75 ? 'text-warn' : 'text-sub';
            return (
              <article key={c.id} className="card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{c.user.fullName} <span className="text-sm font-normal text-sub">{c.user.email}</span></p>
                    <p className="text-sm text-sub">
                      {c.amount ? formatMoney(c.amount, c.currency) : '—'} · {new Date(c.createdAt).toLocaleString()} · decision: <b>{c.decision}</b>
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`tabular text-2xl font-semibold ${tone}`}>{pct}</p>
                    <p className="text-xs text-faint">risk score</p>
                  </div>
                </div>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {c.reasons.map((r: string) => <li key={r} className="badge bg-warn/10 text-warn">▲ {r}</li>)}
                </ul>
                {c.features && (
                  <details className="mt-3 text-sm">
                    <summary className="cursor-pointer text-sub">Signals</summary>
                    <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
                      {Object.entries(featureLabels).map(([k, label]) => (
                        <div key={k} className="flex justify-between gap-2 border-b border-line py-1">
                          <dt className="text-sub">{label}</dt>
                          <dd className="tabular">{typeof c.features[k] === 'number' ? (k.startsWith('is_') ? (c.features[k] ? 'Yes' : 'No') : Math.round(c.features[k] * 100) / 100) : '—'}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                )}
                {c.status === 'open' && (
                  <div className="mt-4 flex gap-2">
                    <button className="btn-primary" disabled={busy === c.id} onClick={() => act(c.id, 'approve')}>Approve & release</button>
                    <button className="btn-danger" disabled={busy === c.id} onClick={() => act(c.id, 'reject')}>Reject & refund</button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
