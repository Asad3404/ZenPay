'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, errorMessage, PageHeader, Spinner, useMfa } from '@/components/ui';
import { api, CURRENCIES, formatMoney, newKey } from '@/lib/api';

type Action = 'deposit' | 'withdraw' | 'convert';

export default function WalletsPage() {
  const { run, modal } = useMfa();
  const [overview, setOverview] = useState<any>(null);
  const [action, setAction] = useState<Action>('deposit');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [to, setTo] = useState('EUR');
  const [quote, setQuote] = useState<any>(null);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api('/wallets').then(setOverview).catch((e) => setMsg({ kind: 'error', text: errorMessage(e) })), []);
  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setQuote(null);
    if (action !== 'convert' || !Number(amount) || currency === to) return;
    const t = setTimeout(() => {
      api(`/fx/quote?from=${currency}&to=${to}&amount=${amount}`, { auth: false }).then(setQuote).catch(() => setQuote(null));
    }, 300);
    return () => clearTimeout(t);
  }, [action, amount, currency, to]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    const idempotencyKey = newKey();
    try {
      if (action === 'deposit') {
        await api('/wallets/deposit', { body: { amount, currency, idempotencyKey } });
        setMsg({ kind: 'success', text: `Added ${formatMoney(amount, currency)} to your wallet.` });
      } else if (action === 'withdraw') {
        const r = await run((mfaCode) => api('/wallets/withdraw', { body: { amount, currency, idempotencyKey, mfaCode } }));
        if (!r) return;
        setMsg({ kind: 'success', text: `Withdrawal of ${formatMoney(amount, currency)} is on its way to your bank (ref ${r.payoutReference}).` });
      } else {
        const r = await api('/wallets/convert', { body: { amount, from: currency, to, idempotencyKey } });
        setMsg({ kind: 'success', text: `Converted ${r.sent} to ${r.received} (fee ${r.fee}).` });
      }
      setAmount('');
      load();
    } catch (err) {
      setMsg({ kind: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const openWallet = async (cur: string) => {
    await api('/wallets', { body: { currency: cur } }).catch((e) => setMsg({ kind: 'error', text: errorMessage(e) }));
    load();
  };

  const owned = new Set<string>(overview?.wallets.map((w: any) => w.currency) ?? []);

  return (
    <>
      {modal}
      <PageHeader title="Wallets" subtitle="Hold, convert and move money in multiple currencies." />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <section className="space-y-3">
          {!overview && <Spinner />}
          <div className="grid gap-3 sm:grid-cols-2">
            {overview?.wallets.map((w: any) => (
              <div key={w.accountId} className="card">
                <p className="text-sm text-sub">{w.currency} wallet</p>
                <p className="tabular mt-1 text-2xl font-semibold">{formatMoney(w.balance, w.currency)}</p>
              </div>
            ))}
          </div>
          {overview && (
            <div className="card">
              <p className="mb-2 text-sm font-medium">Open another currency wallet</p>
              <div className="flex flex-wrap gap-2">
                {CURRENCIES.filter((c) => !owned.has(c)).map((c) => (
                  <button key={c} className="btn-ghost px-3 py-1.5" onClick={() => openWallet(c)}>+ {c}</button>
                ))}
                {CURRENCIES.every((c) => owned.has(c)) && <p className="text-sm text-faint">You have every supported currency.</p>}
              </div>
            </div>
          )}
        </section>

        <form onSubmit={submit} className="card h-fit space-y-4">
          <div className="grid grid-cols-3 rounded-xl bg-muted p-1 text-sm font-medium" role="tablist">
            {(['deposit', 'withdraw', 'convert'] as Action[]).map((a) => (
              <button type="button" key={a} role="tab" aria-selected={action === a} onClick={() => { setAction(a); setMsg(null); }} className={`rounded-lg py-2 capitalize ${action === a ? 'bg-surface shadow-sm' : 'text-sub'}`}>
                {a === 'deposit' ? 'Add' : a}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-[1fr_6.5rem] gap-3">
            <div>
              <label className="label" htmlFor="amount">Amount</label>
              <input id="amount" inputMode="decimal" className="input tabular" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} placeholder="0.00" required />
            </div>
            <div>
              <label className="label" htmlFor="cur">{action === 'convert' ? 'From' : 'Currency'}</label>
              <select id="cur" className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>
          {action === 'convert' && (
            <div>
              <label className="label" htmlFor="to">To</label>
              <select id="to" className="input" value={to} onChange={(e) => setTo(e.target.value)}>
                {CURRENCIES.filter((c) => c !== currency).map((c) => <option key={c}>{c}</option>)}
              </select>
              {quote && (
                <div className="mt-3 space-y-1 rounded-xl bg-muted p-3 text-sm">
                  <div className="flex justify-between"><span className="text-sub">Rate</span><span className="tabular">1 {quote.from} = {quote.rate.toFixed(4)} {quote.to}</span></div>
                  <div className="flex justify-between"><span className="text-sub">Fee (0.5%)</span><span className="tabular">{formatMoney(quote.fee, quote.from)}</span></div>
                  <div className="flex justify-between font-semibold"><span>You get</span><span className="tabular">{formatMoney(quote.receive, quote.to)}</span></div>
                </div>
              )}
            </div>
          )}
          {action === 'deposit' && <p className="text-xs text-faint">Sandbox mode: top-ups are simulated. Amounts ending in .13 are declined, to test errors.</p>}
          {action === 'withdraw' && <p className="text-xs text-faint">Withdrawals need a verified identity and go to your linked bank account.</p>}
          {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
          <button className="btn-primary w-full" disabled={busy || !amount}>
            {busy && <Spinner />} {action === 'deposit' ? 'Add money' : action === 'withdraw' ? 'Withdraw' : 'Convert'}
          </button>
        </form>
      </div>
    </>
  );
}
