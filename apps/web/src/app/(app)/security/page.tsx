'use client';

import { useCallback, useEffect, useState } from 'react';
import { QrScanner } from '@/components/QrScanner';
import { Alert, errorMessage, PageHeader, Spinner } from '@/components/ui';
import { api, CURRENCIES, updateUser } from '@/lib/api';

function MfaCard({ enabled, onChange }: { enabled: boolean; onChange: () => void }) {
  const [setup, setSetup] = useState<{ secret: string; qrCodeDataUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const start = async () => {
    setMsg(null);
    try {
      setSetup(await api('/auth/mfa/setup', { body: {} }));
    } catch (e) {
      setMsg({ kind: 'error', text: errorMessage(e) });
    }
  };
  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api(enabled ? '/auth/mfa/disable' : '/auth/mfa/enable', { body: { code } });
      setMsg({ kind: 'success', text: enabled ? 'Two-factor authentication is off.' : 'Two-factor authentication is on.' });
      updateUser({ mfaEnabled: !enabled });
      setSetup(null);
      setCode('');
      onChange();
    } catch (err) {
      setMsg({ kind: 'error', text: errorMessage(err) });
    }
  };

  return (
    <section className="card space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Two-factor authentication</h2>
          <p className="text-sm text-sub">Use an authenticator app (Google Authenticator, Authy, 1Password) for sign-in and large payments.</p>
        </div>
        <span className={`badge shrink-0 ${enabled ? 'bg-good/15 text-good' : 'bg-warn/15 text-warn'}`}>{enabled ? '● On' : '▲ Off'}</span>
      </div>
      {!enabled && !setup && <button className="btn-primary" onClick={start}>Set up</button>}
      {setup && (
        <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
          <img src={setup.qrCodeDataUrl} alt="Scan with your authenticator app" className="w-40 rounded-xl border border-line bg-white p-2" />
          <div className="space-y-2 text-sm">
            <p>1. Scan this code with your authenticator app.</p>
            <p className="text-sub">Can’t scan? Enter this key: <code className="break-all rounded bg-muted px-1.5 py-0.5 text-xs">{setup.secret}</code></p>
            <p>2. Enter the 6-digit code it shows.</p>
          </div>
        </div>
      )}
      {(setup || enabled) && (
        <form onSubmit={confirm} className="flex gap-2">
          <input aria-label="Authenticator code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="input max-w-40 text-center tracking-[0.3em]" placeholder="000000" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          <button className={enabled ? 'btn-danger' : 'btn-primary'} disabled={code.length !== 6}>{enabled ? 'Turn off' : 'Turn on'}</button>
        </form>
      )}
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
    </section>
  );
}

function KycCard({ level, onChange }: { level: number; onChange: () => void }) {
  const [status, setStatus] = useState<any>(null);
  const [form, setForm] = useState({ fullName: '', dateOfBirth: '', country: 'PK', idType: 'national_id', idNumber: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api('/kyc').then(setStatus).catch(() => undefined);
  }, [level]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      setStatus(await api('/kyc', { body: { ...form, country: form.country.toUpperCase() } }));
      onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <section id="verify" className="card space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Identity verification</h2>
          <p className="text-sm text-sub">Daily sending limit: <b className="tabular">${status?.dailyLimitUsd ?? '…'}</b></p>
        </div>
        <span className={`badge shrink-0 ${level > 0 ? 'bg-good/15 text-good' : 'bg-warn/15 text-warn'}`}>{level > 0 ? `● Level ${level}` : '▲ Not verified'}</span>
      </div>
      {level === 0 && (
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="kname">Legal name</label>
            <input id="kname" className="input" required value={form.fullName} onChange={set('fullName')} />
          </div>
          <div>
            <label className="label" htmlFor="dob">Date of birth</label>
            <input id="dob" type="date" className="input" required value={form.dateOfBirth} onChange={set('dateOfBirth')} />
          </div>
          <div>
            <label className="label" htmlFor="country">Country code</label>
            <input id="country" className="input uppercase" maxLength={2} required value={form.country} onChange={set('country')} />
          </div>
          <div>
            <label className="label" htmlFor="idtype">Document</label>
            <select id="idtype" className="input" value={form.idType} onChange={set('idType')}>
              <option value="national_id">National ID</option>
              <option value="passport">Passport</option>
              <option value="driving_license">Driving licence</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="idnum">Document number</label>
            <input id="idnum" className="input" required minLength={5} value={form.idNumber} onChange={set('idNumber')} />
          </div>
          {error && <div className="sm:col-span-2"><Alert>{error}</Alert></div>}
          <p className="text-xs text-faint sm:col-span-2">Sandbox: verification is simulated. In production this hands off to a KYC provider; SecurePay stores only the last 4 characters of your document number.</p>
          <button className="btn-primary sm:col-span-2" disabled={busy}>{busy && <Spinner />} Verify identity</button>
        </form>
      )}
    </section>
  );
}

function ApproveQrLogin() {
  const [scanning, setScanning] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const onResult = useCallback(async (text: string) => {
    setScanning(false);
    const sid = /securepay:\/\/login\?sid=([\w-]+)/.exec(text)?.[1];
    if (!sid) return setMsg({ kind: 'error', text: 'That isn’t a SecurePay sign-in code.' });
    try {
      await api('/auth/qr/approve', { body: { sessionId: sid } });
      setMsg({ kind: 'success', text: 'Approved. The other device is now signed in.' });
    } catch (e) {
      setMsg({ kind: 'error', text: errorMessage(e) });
    }
  }, []);
  return (
    <section className="card space-y-3">
      <h2 className="font-semibold">Scan to sign in</h2>
      <p className="text-sm text-sub">Sign in on a computer without typing your password: open the SecurePay login page there, choose “Scan QR code”, then scan it here. Only approve codes you opened yourself.</p>
      {scanning ? <QrScanner onResult={onResult} /> : <button className="btn-ghost" onClick={() => { setMsg(null); setScanning(true); }}>▦ Open scanner</button>}
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
    </section>
  );
}

export default function SecurityPage() {
  const [me, setMe] = useState<any>(null);
  const [saved, setSaved] = useState('');
  const load = useCallback(() => api('/me').then(setMe), []);
  useEffect(() => {
    load();
  }, [load]);

  if (!me) return <Spinner />;
  return (
    <>
      <PageHeader title="Security & profile" subtitle={me.email} />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <MfaCard enabled={me.mfaEnabled} onChange={load} />
          <ApproveQrLogin />
        </div>
        <div className="space-y-6">
          <KycCard level={me.kycLevel} onChange={load} />
          <section className="card space-y-3">
            <h2 className="font-semibold">Display currency</h2>
            <p className="text-sm text-sub">Your total balance and insights are shown in this currency.</p>
            <select
              aria-label="Display currency"
              className="input max-w-40"
              value={me.baseCurrency}
              onChange={async (e) => {
                setMe(await api('/me', { method: 'PATCH', body: { baseCurrency: e.target.value } }));
                setSaved('Saved.');
              }}
            >
              {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
            </select>
            {saved && <p className="text-xs text-good">{saved}</p>}
          </section>
        </div>
      </div>
    </>
  );
}
