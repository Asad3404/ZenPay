'use client';

import { useState } from 'react';
import { Alert, errorMessage, PageHeader, Spinner, useMfa } from '@/components/ui';
import { api, CURRENCIES, formatMoney, newKey } from '@/lib/api';

interface Recipient {
  id: string;
  fullName: string;
  maskedEmail: string;
}

export default function SendPage() {
  const { run, modal } = useMfa();
  const [query, setQuery] = useState('');
  const [recipient, setRecipient] = useState<Recipient | null>(null);
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [note, setNote] = useState('');
  const [key, setKey] = useState(newKey);
  const [error, setError] = useState('');
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const find = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setRecipient(null);
    try {
      setRecipient(await api(`/transfers/lookup?q=${encodeURIComponent(query.trim())}`));
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recipient) return;
    setError('');
    setBusy(true);
    try {
      const r = await run((mfaCode) =>
        api('/transfers', { body: { recipientId: recipient.id, amount, currency, note: note || undefined, idempotencyKey: key, mfaCode } }),
      );
      if (r) setResult(r);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setResult(null);
    setRecipient(null);
    setQuery('');
    setAmount('');
    setNote('');
    setKey(newKey());
  };

  if (result) {
    const held = result.status === 'held';
    return (
      <>
        <PageHeader title={held ? 'Payment under review' : 'Money sent'} />
        <div className="card max-w-lg space-y-4 text-center">
          <div className={`mx-auto grid h-14 w-14 place-items-center rounded-full text-2xl ${held ? 'bg-warn/15 text-warn' : 'bg-good/15 text-good'}`} aria-hidden>
            {held ? '!' : '✓'}
          </div>
          <p className="text-lg font-semibold">
            {formatMoney(amount, currency)} to {recipient?.fullName}
          </p>
          {held ? (
            <p className="text-sm text-sub">
              For your security, this payment is on hold while our team reviews it. The money is reserved and you’ll get a notification as soon as it’s approved or returned.
            </p>
          ) : (
            <p className="text-sm text-sub">Delivered instantly.</p>
          )}
          <button className="btn-primary w-full" onClick={reset}>Send another</button>
        </div>
      </>
    );
  }

  return (
    <>
      {modal}
      <PageHeader title="Send money" subtitle="Instant transfers to any SecurePay user, free." />
      <div className="max-w-lg space-y-5">
        <form onSubmit={find} className="card space-y-3">
          <label className="label" htmlFor="q">Recipient’s email or phone</label>
          <div className="flex gap-2">
            <input id="q" className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="friend@example.com" required />
            <button className="btn-ghost shrink-0">Find</button>
          </div>
          {recipient && (
            <div className="flex items-center gap-3 rounded-xl bg-muted p-3">
              <div className="grid h-10 w-10 place-items-center rounded-full bg-brand/15 font-semibold text-brand">{recipient.fullName[0]}</div>
              <div>
                <p className="text-sm font-semibold">{recipient.fullName}</p>
                <p className="text-xs text-sub">{recipient.maskedEmail}</p>
              </div>
            </div>
          )}
        </form>

        {recipient && (
          <form onSubmit={send} className="card space-y-4">
            <div className="grid grid-cols-[1fr_7rem] gap-3">
              <div>
                <label className="label" htmlFor="amount">Amount</label>
                <input id="amount" inputMode="decimal" className="input tabular text-lg" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} required />
              </div>
              <div>
                <label className="label" htmlFor="cur">Currency</label>
                <select id="cur" className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="label" htmlFor="note">Note (optional)</label>
              <input id="note" maxLength={140} className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Dinner, rent, gift…" />
            </div>
            {error && <Alert>{error}</Alert>}
            <button className="btn-primary w-full" disabled={busy || !amount}>
              {busy && <Spinner />} Send {amount ? formatMoney(amount, currency) : ''}
            </button>
          </form>
        )}
        {!recipient && error && <Alert>{error}</Alert>}
      </div>
    </>
  );
}
