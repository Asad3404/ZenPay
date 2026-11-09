'use client';

import { useEffect, useRef, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Alert, Empty, errorMessage, PageHeader, Spinner } from '@/components/ui';
import { api, formatMoney } from '@/lib/api';

interface Insights {
  currency: string;
  thisMonth: { spent: number; received: number };
  lastMonth: { spent: number; received: number };
  forecastNextMonth: number;
  monthly: { month: string; spent: number; received: number }[];
  categories: { category: string; amount: number; previousMonth: number }[];
  topMerchants: { name: string; amount: number }[];
  budgets: { category: string; limit: number; spent: number; projected: number; percentUsed: number; status: 'on_track' | 'at_risk' | 'over' }[];
  tips: string[];
}

const monthLabel = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString(undefined, { month: 'short' });

function ChartTooltip({ active, payload, label, currency }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-sm">
      <p className="mb-1 font-medium">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} className="tabular flex items-center gap-2 text-sub">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ background: p.color }} />
          {p.name}: <span className="text-ink">{formatMoney(p.value, currency)}</span>
        </p>
      ))}
    </div>
  );
}

function Assistant() {
  const [history, setHistory] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [history, busy]);

  const ask = async (text: string) => {
    if (!text.trim() || busy) return;
    setError('');
    setInput('');
    const prior = history;
    setHistory([...prior, { role: 'user', content: text }]);
    setBusy(true);
    try {
      const r = await api('/insights/assistant', { body: { message: text, history: prior } });
      setHistory((h) => [...h, { role: 'assistant', content: r.reply + (r.notice ? `\n\n(${r.notice})` : '') }]);
    } catch (e) {
      setError(errorMessage(e));
      setHistory(prior);
      setInput(text);
    } finally {
      setBusy(false);
    }
  };

  const suggestions = ['Where does my money go?', 'Am I on track with my budgets?', 'How much will I spend next month?', 'How can I save more?'];

  return (
    <section className="card flex h-[32rem] flex-col">
      <h2 className="font-semibold">Ask the money assistant</h2>
      <p className="text-xs text-faint">Answers use your SecurePay activity. The assistant can’t move money and never asks for codes or passwords.</p>
      <div className="mt-3 flex-1 space-y-3 overflow-y-auto pr-1" aria-live="polite">
        {history.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button key={s} className="rounded-full border border-line px-3 py-1.5 text-xs hover:bg-muted" onClick={() => ask(s)}>{s}</button>
            ))}
          </div>
        )}
        {history.map((m, i) => (
          <div key={i} className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm ${m.role === 'user' ? 'ml-auto bg-brand text-brand-ink' : 'bg-muted'}`}>
            {m.content}
          </div>
        ))}
        {busy && <div className="inline-flex items-center gap-2 rounded-2xl bg-muted px-3.5 py-2.5 text-sm text-sub"><Spinner /> Thinking…</div>}
        <div ref={end} />
      </div>
      {error && <Alert>{error}</Alert>}
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); ask(input); }}>
        <input aria-label="Message" className="input" maxLength={1000} placeholder="Ask about your spending…" value={input} onChange={(e) => setInput(e.target.value)} />
        <button className="btn-primary shrink-0" disabled={busy || !input.trim()}>Send</button>
      </form>
    </section>
  );
}

function Budgets({ data, currency, onChange }: { data: Insights['budgets']; currency: string; onChange: () => void }) {
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState('Groceries');
  const [limit, setLimit] = useState('');
  const [list, setList] = useState<any[]>([]);
  useEffect(() => {
    api('/insights/categories').then(setCategories);
    api('/insights/budgets').then(setList);
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setList(await api('/insights/budgets', { body: { category, monthlyLimit: limit, currency } }));
    setLimit('');
    onChange();
  };
  const remove = async (id: string) => {
    setList(await api(`/insights/budgets/${id}`, { method: 'DELETE' }));
    onChange();
  };
  const tone = { on_track: 'bg-good', at_risk: 'bg-warn', over: 'bg-bad' };
  const label = { on_track: 'On track', at_risk: 'At risk', over: 'Over budget' };

  return (
    <section className="card space-y-4">
      <h2 className="font-semibold">Monthly budgets</h2>
      {data.length === 0 && <p className="text-sm text-faint">No budgets yet. Add one below.</p>}
      <ul className="space-y-3">
        {data.map((b) => {
          const id = list.find((l) => l.category === b.category)?.id;
          return (
            <li key={b.category}>
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{b.category}</span>
                <span className="tabular text-sub">{formatMoney(b.spent, currency)} / {formatMoney(b.limit, currency)}</span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(b.percentUsed)} aria-valuemin={0} aria-valuemax={100} aria-label={`${b.category} budget used`}>
                <div className={`h-full rounded-full ${tone[b.status]}`} style={{ width: `${Math.min(100, b.percentUsed)}%` }} />
              </div>
              <div className="mt-1 flex justify-between text-xs">
                <span className={b.status === 'on_track' ? 'text-good' : b.status === 'at_risk' ? 'text-warn' : 'text-bad'}>
                  {b.status === 'on_track' ? '●' : '▲'} {label[b.status]}
                </span>
                {id && <button className="text-faint hover:text-bad" onClick={() => remove(id)}>Remove</button>}
              </div>
            </li>
          );
        })}
      </ul>
      <form onSubmit={save} className="grid grid-cols-[1fr_6rem_auto] gap-2">
        <select aria-label="Category" className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
          {categories.map((c) => <option key={c}>{c}</option>)}
        </select>
        <input aria-label={`Monthly limit in ${currency}`} inputMode="decimal" className="input tabular" placeholder="Limit" value={limit} onChange={(e) => setLimit(e.target.value.replace(/[^\d.]/g, ''))} required />
        <button className="btn-ghost">Save</button>
      </form>
    </section>
  );
}

export default function InsightsPage() {
  const [data, setData] = useState<Insights | null>(null);
  const [error, setError] = useState('');
  const [showTable, setShowTable] = useState(false);
  const load = () => api('/insights').then(setData).catch((e) => setError(errorMessage(e)));
  useEffect(() => {
    load();
  }, []);

  const cur = data?.currency ?? 'USD';
  const monthly = data?.monthly.map((m) => ({ ...m, label: monthLabel(m.month) })) ?? [];
  const maxCat = Math.max(1, ...(data?.categories.map((c) => c.amount) ?? [1]));

  return (
    <>
      <PageHeader title="Insights" subtitle="AI-powered analysis of your spending." />
      {error && <Alert kind="warn">{error}</Alert>}
      {!data && !error && <Spinner />}
      {data && (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ['Spent this month', data.thisMonth.spent, `Last month ${formatMoney(data.lastMonth.spent, cur)}`],
              ['Received this month', data.thisMonth.received, `Last month ${formatMoney(data.lastMonth.received, cur)}`],
              ['Forecast next month', data.forecastNextMonth, 'Based on your recent trend'],
            ].map(([label, value, sub]) => (
              <div key={label as string} className="card">
                <p className="text-sm text-sub">{label}</p>
                <p className="tabular mt-1 text-2xl font-semibold">{formatMoney(value as number, cur)}</p>
                <p className="mt-1 text-xs text-faint">{sub}</p>
              </div>
            ))}
          </div>

          {data.tips.length > 0 && (
            <section className="card border-brand/30 bg-brand/5">
              <h2 className="mb-2 font-semibold">Suggestions for you</h2>
              <ul className="space-y-1.5 text-sm">
                {data.tips.map((t) => <li key={t} className="flex gap-2"><span className="text-brand" aria-hidden>✦</span>{t}</li>)}
              </ul>
            </section>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="card">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-semibold">Money in and out</h2>
                <button className="text-xs font-medium text-brand" onClick={() => setShowTable((s) => !s)}>{showTable ? 'Show chart' : 'Show table'}</button>
              </div>
              {monthly.length === 0 ? (
                <Empty>Not enough history yet.</Empty>
              ) : showTable ? (
                <table className="tabular w-full text-sm">
                  <thead><tr className="text-left text-sub"><th className="py-1 font-medium">Month</th><th className="text-right font-medium">Spent</th><th className="text-right font-medium">Received</th></tr></thead>
                  <tbody>{monthly.map((m) => <tr key={m.month} className="border-t border-line"><td className="py-1.5">{m.label}</td><td className="text-right">{formatMoney(m.spent, cur)}</td><td className="text-right">{formatMoney(m.received, cur)}</td></tr>)}</tbody>
                </table>
              ) : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={monthly} barGap={2} margin={{ left: -12, right: 4, top: 4 }}>
                      <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                      <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: 'rgb(var(--sub))' }} />
                      <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: 'rgb(var(--sub))' }} width={56} />
                      <Tooltip cursor={{ fill: 'rgb(var(--muted))' }} content={<ChartTooltip currency={cur} />} />
                      <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12 }} formatter={(value) => <span style={{ color: 'rgb(var(--sub))' }}>{value}</span>} />
                      <Bar dataKey="spent" name="Spent" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={22} />
                      <Bar dataKey="received" name="Received" fill="var(--series-2)" radius={[4, 4, 0, 0]} maxBarSize={22} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </section>

            <section className="card">
              <h2 className="mb-3 font-semibold">This month by category</h2>
              {data.categories.length === 0 ? (
                <Empty>No spending this month yet.</Empty>
              ) : (
                <ul className="space-y-2.5">
                  {data.categories.map((c) => (
                    <li key={c.category} title={`${c.category}: ${formatMoney(c.amount, cur)} (last month ${formatMoney(c.previousMonth, cur)})`}>
                      <div className="flex justify-between text-sm">
                        <span>{c.category}</span>
                        <span className="tabular font-medium">{formatMoney(c.amount, cur)}</span>
                      </div>
                      <div className="mt-1 h-2 rounded-full bg-muted">
                        <div className="h-full rounded-full" style={{ width: `${(100 * c.amount) / maxCat}%`, background: 'var(--series-1)' }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Assistant />
            <div className="space-y-6">
              <Budgets data={data.budgets} currency={cur} onChange={load} />
              {data.topMerchants.length > 0 && (
                <section className="card">
                  <h2 className="mb-2 font-semibold">Where you spend most</h2>
                  <ul className="divide-y divide-line text-sm">
                    {data.topMerchants.map((m) => (
                      <li key={m.name} className="flex justify-between py-2"><span>{m.name}</span><span className="tabular">{formatMoney(m.amount, cur)}</span></li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          </div>
        </div>
      )}
      {!data && error && <div className="mt-6"><Assistant /></div>}
    </>
  );
}

