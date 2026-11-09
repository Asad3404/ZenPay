'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Alert, errorMessage, PageHeader, Spinner } from '@/components/ui';
import { api, formatMoney } from '@/lib/api';

export default function AdminOverview() {
  const [s, setS] = useState<any>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api('/admin/stats').then(setS).catch((e) => setError(errorMessage(e)));
  }, []);

  if (error) return <Alert>{error}</Alert>;
  if (!s) return <Spinner />;
  const tiles = [
    ['Users', s.users.toLocaleString(), `${s.newUsers7d} new this week`],
    ['Transactions (24h)', s.transactions24h.toLocaleString(), `${formatMoney(s.volume24hUsd, 'USD')} sent`],
    ['Open fraud cases', s.openFraudCases, `${s.blocked24h} blocked in 24h`],
    ['Frozen accounts', s.frozenUsers, 'Manual review'],
  ];
  const daily = s.daily.map((d: any) => ({ ...d, label: new Date(`${d.day}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) }));

  return (
    <>
      <PageHeader title="Operations overview" subtitle="Live view of the platform." />
      {s.openFraudCases > 0 && (
        <Link href="/admin/fraud" className="mb-6 block">
          <Alert kind="warn">▲ {s.openFraudCases} payment{s.openFraudCases === 1 ? ' is' : 's are'} on hold waiting for review →</Alert>
        </Link>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map(([label, value, sub]) => (
          <div key={label} className="card">
            <p className="text-sm text-sub">{label}</p>
            <p className="tabular mt-1 text-2xl font-semibold">{value}</p>
            <p className="mt-1 text-xs text-faint">{sub}</p>
          </div>
        ))}
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_18rem]">
        <section className="card">
          <h2 className="mb-3 font-semibold">Payment volume, last 14 days (USD)</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={daily} margin={{ left: -12, right: 4, top: 4 }}>
                <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'rgb(var(--sub))' }} interval="preserveStartEnd" />
                <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'rgb(var(--sub))' }} width={56} />
                <Tooltip
                  cursor={{ fill: 'rgb(var(--muted))' }}
                  content={({ active, payload, label }: any) =>
                    active && payload?.length ? (
                      <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-sm">
                        <p className="font-medium">{label}</p>
                        <p className="tabular text-sub">{formatMoney(payload[0].payload.volumeUsd, 'USD')} · {payload[0].payload.count} transactions</p>
                      </div>
                    ) : null
                  }
                />
                <Bar dataKey="volumeUsd" name="Volume" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="card">
          <h2 className="mb-3 font-semibold">Fee revenue</h2>
          {s.feeRevenue.length === 0 ? (
            <p className="text-sm text-faint">No fees collected yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {s.feeRevenue.map((f: any) => (
                <li key={f.currency} className="flex justify-between"><span>{f.currency}</span><span className="tabular font-medium">{formatMoney(f.amount, f.currency)}</span></li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
