'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { QrScanner } from '@/components/QrScanner';
import { Alert, errorMessage, PageHeader, Spinner, useMfa } from '@/components/ui';
import { api, CURRENCIES, formatMoney, newKey } from '@/lib/api';

interface Parsed {
  type: 'static' | 'dynamic';
  requestId: string | null;
  merchant: { id: string; fullName: string };
  currency: string;
  amount: string | null;
  reference: string | null;
}

function Pay() {
  const { run, modal } = useMfa();
  const [scanning, setScanning] = useState(false);
  const [payload, setPayload] = useState('');
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [amount, setAmount] = useState('');
  const [key, setKey] = useState(newKey);
  const [error, setError] = useState('');
  const [done, setDone] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const parse = useCallback(async (text: string) => {
    setScanning(false);
    setError('');
    setPayload(text);
    try {
      setParsed(await api('/payments/qr/parse', { body: { payload: text } }));
    } catch (err) {
      setParsed(null);
      setError(errorMessage(err));
    }
  }, []);

  const pay = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await run((mfaCode) => api('/payments/qr/pay', { body: { payload, amount: parsed?.type === 'static' ? amount : undefined, idempotencyKey: key, mfaCode } }));
      if (r) setDone(r);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="card max-w-md space-y-3 text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-good/15 text-2xl text-good" aria-hidden>{done.status === 'held' ? '!' : '✓'}</div>
        <p className="text-lg font-semibold">{done.status === 'held' ? 'Payment under review' : `Paid ${parsed?.merchant.fullName}`}</p>
        <p className="text-sm text-sub">{formatMoney(parsed?.amount ?? amount, parsed?.currency ?? 'USD')}</p>
        <button className="btn-primary w-full" onClick={() => { setDone(null); setParsed(null); setPayload(''); setAmount(''); setKey(newKey()); }}>Done</button>
      </div>
    );
  }

  return (
    <div className="max-w-md space-y-4">
      {modal}
      {!parsed && (
        <div className="card space-y-4">
          {scanning ? (
            <>
              <QrScanner onResult={parse} />
              <button className="btn-ghost w-full" onClick={() => setScanning(false)}>Cancel</button>
            </>
          ) : (
            <button className="btn-primary w-full py-4" onClick={() => setScanning(true)}>▦ Scan a QR code</button>
          )}
          <form onSubmit={(e) => { e.preventDefault(); parse(payload.trim()); }} className="space-y-2">
            <label className="label" htmlFor="payload">Or paste the QR text</label>
            <textarea id="payload" rows={3} className="input font-mono text-xs" value={payload} onChange={(e) => setPayload(e.target.value)} />
            <button className="btn-ghost w-full" disabled={!payload.trim()}>Continue</button>
          </form>
        </div>
      )}
      {parsed && (
        <div className="card space-y-4">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-full bg-brand/15 text-lg font-semibold text-brand">{parsed.merchant.fullName[0]}</div>
            <div>
              <p className="font-semibold">{parsed.merchant.fullName}</p>
              {parsed.reference && <p className="text-xs text-sub">Ref: {parsed.reference}</p>}
            </div>
          </div>
          {parsed.type === 'dynamic' ? (
            <p className="tabular text-3xl font-semibold">{formatMoney(parsed.amount!, parsed.currency)}</p>
          ) : (
            <div>
              <label className="label" htmlFor="amt">Amount ({parsed.currency})</label>
              <input id="amt" autoFocus inputMode="decimal" className="input tabular text-lg" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} placeholder="0.00" />
            </div>
          )}
          {error && <Alert>{error}</Alert>}
          <div className="flex gap-2">
            <button className="btn-ghost flex-1" onClick={() => { setParsed(null); setError(''); }}>Cancel</button>
            <button className="btn-primary flex-1" disabled={busy || (parsed.type === 'static' && !amount)} onClick={pay}>
              {busy && <Spinner />} Pay
            </button>
          </div>
        </div>
      )}
      {!parsed && error && <Alert>{error}</Alert>}
    </div>
  );
}

function Receive() {
  const [mine, setMine] = useState<{ qrCodeDataUrl: string; payload: string; currency: string } | null>(null);
  const [requests, setRequests] = useState<any[]>([]);
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [reference, setReference] = useState('');
  const [created, setCreated] = useState<any>(null);
  const [error, setError] = useState('');

  const load = () => api('/payments/requests').then(setRequests).catch(() => undefined);
  useEffect(() => {
    api('/payments/my-qr').then((m) => { setMine(m); setCurrency(m.currency); }).catch((e) => setError(errorMessage(e)));
    load();
  }, []);

  // Refresh the request list while a QR is on screen, to show when it gets paid.
  useEffect(() => {
    if (!created) return;
    const t = setInterval(async () => {
      const list = await api('/payments/requests').catch(() => null);
      if (!list) return;
      setRequests(list);
      const cur = list.find((r: any) => r.id === created.id);
      if (cur && cur.status !== 'pending') setCreated({ ...created, status: cur.status });
    }, 3000);
    return () => clearInterval(t);
  }, [created]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      setCreated(await api('/payments/requests', { body: { amount, currency, reference: reference || undefined } }));
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="card space-y-3 text-center">
        <h2 className="text-left font-semibold">My QR code</h2>
        <p className="text-left text-sm text-sub">Anyone with SecurePay can scan this to pay you any amount.</p>
        <div className="mx-auto w-56 rounded-2xl border border-line bg-white p-3">
          {mine ? <img src={mine.qrCodeDataUrl} alt="Your personal SecurePay QR code" /> : <Spinner className="text-sub" />}
        </div>
      </section>
      <section className="card space-y-4">
        <h2 className="font-semibold">Request a specific amount</h2>
        {created ? (
          <div className="space-y-3 text-center">
            <div className="mx-auto w-56 rounded-2xl border border-line bg-white p-3">
              <img src={created.qrCodeDataUrl} alt={`QR code to pay ${created.amount} ${created.currency}`} />
            </div>
            <p className="tabular text-xl font-semibold">{formatMoney(created.amount, created.currency)}</p>
            {created.status === 'paid' ? <Alert kind="success">Paid! The money is in your wallet.</Alert> : <p className="text-xs text-sub">Valid for 15 minutes · single use</p>}
            <button className="btn-ghost w-full" onClick={() => setCreated(null)}>New request</button>
          </div>
        ) : (
          <form onSubmit={create} className="space-y-3">
            <div className="grid grid-cols-[1fr_7rem] gap-3">
              <input aria-label="Amount" inputMode="decimal" className="input tabular" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} required />
              <select aria-label="Currency" className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <input aria-label="Reference" maxLength={25} className="input" placeholder="Reference (optional), e.g. ORDER-42" value={reference} onChange={(e) => setReference(e.target.value)} />
            {error && <Alert>{error}</Alert>}
            <button className="btn-primary w-full">Create QR code</button>
          </form>
        )}
        {requests.length > 0 && (
          <ul className="divide-y divide-line border-t border-line pt-2 text-sm">
            {requests.slice(0, 5).map((r) => (
              <li key={r.id} className="flex justify-between py-2">
                <span className="tabular">{formatMoney(r.amount, r.currency)} {r.reference && <span className="text-faint">· {r.reference}</span>}</span>
                <span className={`badge ${r.status === 'paid' ? 'bg-good/15 text-good' : r.status === 'pending' ? 'bg-brand/10 text-brand' : 'bg-muted text-faint'}`}>{r.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function PayPage() {
  const params = useSearchParams();
  const [tab, setTab] = useState<'pay' | 'receive'>(params.get('tab') === 'receive' ? 'receive' : 'pay');
  return (
    <>
      <PageHeader title="QR payments" subtitle="Scan to pay, or show your code to get paid." />
      <div className="mb-6 inline-grid grid-cols-2 rounded-xl bg-muted p-1 text-sm font-medium" role="tablist">
        {(['pay', 'receive'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`rounded-lg px-6 py-2 ${tab === t ? 'bg-surface shadow-sm' : 'text-sub'}`}>
            {t === 'pay' ? 'Pay' : 'Receive'}
          </button>
        ))}
      </div>
      {tab === 'pay' ? <Pay /> : <Receive />}
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <PayPage />
    </Suspense>
  );
}
