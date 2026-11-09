'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Alert, errorMessage, PageHeader, Spinner, Tx, TxList } from '@/components/ui';
import { api, formatMoney, getUser } from '@/lib/api';

interface Overview {
  baseCurrency: string;
  totalInBase: string;
  wallets: { accountId: string; currency: string; balance: string }[];
}

interface Note {
  id: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

export default function Dashboard() {
  const user = getUser();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [tx, setTx] = useState<Tx[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [me, setMe] = useState<{ kycLevel: number; mfaEnabled: boolean } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api('/wallets'), api('/wallets/transactions?limit=6'), api('/notifications'), api('/me')])
      .then(([o, t, n, m]) => {
        setOverview(o);
        setTx(t);
        setNotes(n);
        setMe(m);
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);

  const unread = notes.filter((n) => !n.readAt);
  const markRead = async (id: string) => {
    await api(`/notifications/${id}/read`, { body: {} }).catch(() => undefined);
    setNotes((ns) => ns.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)));
  };

  return (
    <>
      <PageHeader title={`Hi, ${user?.fullName.split(' ')[0] ?? 'there'}`} subtitle="Here’s your money at a glance." />
      {error && <Alert>{error}</Alert>}

      {me && (!me.mfaEnabled || me.kycLevel === 0) && (
        <div className="mb-6 grid gap-3 sm:grid-cols-2">
          {!me.mfaEnabled && (
            <Link href="/security" className="card flex items-center gap-3 border-warn/40 p-4 hover:bg-muted">
              <span className="text-xl" aria-hidden>⛨</span>
              <span className="text-sm"><b>Turn on two-factor authentication.</b> <span className="text-sub">Protects your wallet and unlocks larger payments.</span></span>
            </Link>
          )}
          {me.kycLevel === 0 && (
            <Link href="/security#verify" className="card flex items-center gap-3 border-warn/40 p-4 hover:bg-muted">
              <span className="text-xl" aria-hidden>✓</span>
              <span className="text-sm"><b>Verify your identity.</b> <span className="text-sub">Raise your daily limit from $100 to $5,000.</span></span>
            </Link>
          )}
        </div>
      )}

      <section className="card mb-6 overflow-hidden bg-brand p-6 text-brand-ink">
        <p className="text-sm opacity-80">Total balance</p>
        <p className="tabular mt-1 text-4xl font-semibold tracking-tight">
          {overview ? formatMoney(overview.totalInBase, overview.baseCurrency) : <Spinner />}
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          {[
            ['/send', 'Send'],
            ['/pay', 'Scan & pay'],
            ['/wallets', 'Add money'],
            ['/pay?tab=receive', 'Receive'],
          ].map(([href, label]) => (
            <Link key={href} href={href} className="rounded-xl bg-white/15 px-4 py-2 text-sm font-semibold hover:bg-white/25">
              {label}
            </Link>
          ))}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <section className="card">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold">Recent activity</h2>
            <Link href="/transactions" className="text-sm font-medium text-brand">See all</Link>
          </div>
          <TxList items={tx} />
        </section>

        <div className="space-y-6">
          <section className="card">
            <h2 className="mb-3 font-semibold">Wallets</h2>
            <ul className="space-y-2">
              {overview?.wallets.map((w) => (
                <li key={w.accountId} className="flex items-center justify-between rounded-xl bg-muted px-3 py-2.5 text-sm">
                  <span className="font-medium">{w.currency}</span>
                  <span className="tabular">{formatMoney(w.balance, w.currency)}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="card">
            <h2 className="mb-3 font-semibold">
              Notifications {unread.length > 0 && <span className="badge ml-1 bg-brand/15 text-brand">{unread.length} new</span>}
            </h2>
            {notes.length === 0 ? (
              <p className="text-sm text-faint">You’re all caught up.</p>
            ) : (
              <ul className="space-y-3">
                {notes.slice(0, 5).map((n) => (
                  <li key={n.id} className={`text-sm ${n.readAt ? 'text-sub' : ''}`}>
                    <button className="w-full text-left" onClick={() => markRead(n.id)}>
                      <p className="font-medium">{!n.readAt && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-brand" aria-label="unread" />}{n.title}</p>
                      <p className="text-xs text-sub">{n.body}</p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
