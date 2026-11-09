'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Alert, errorMessage, Spinner } from '@/components/ui';
import { api, deviceId, setSession, TokenResponse } from '@/lib/api';

function AuthCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2 text-xl font-bold">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand text-brand-ink">S</span>
          SecurePay
        </div>
        <div className="card p-6 sm:p-8">{children}</div>
      </div>
    </div>
  );
}

function QrLogin({ onDone }: { onDone: (t: TokenResponse) => void }) {
  const [session, setSessionState] = useState<{ sessionId: string; pollSecret: string; qrCodeDataUrl: string; expiresIn: number } | null>(null);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const start = async () => {
      setStatus('loading');
      const s = await api('/auth/qr/session', { body: {}, auth: false });
      if (!alive) return;
      setSessionState(s);
      setStatus('pending');
      const poll = async () => {
        if (!alive) return;
        try {
          const r = await api(`/auth/qr/session/${s.sessionId}/poll`, { body: { pollSecret: s.pollSecret }, auth: false });
          if (r.status === 'approved') return onDone(r);
          if (r.status === 'expired') return setStatus('expired');
        } catch {
          /* keep polling */
        }
        timer = setTimeout(poll, 2000);
      };
      timer = setTimeout(poll, 2000);
    };
    start().catch(() => setStatus('error'));
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [onDone]);

  return (
    <div className="space-y-4 text-center">
      <div className="mx-auto grid aspect-square w-56 place-items-center rounded-2xl border border-line bg-white p-3">
        {session && status === 'pending' ? <img src={session.qrCodeDataUrl} alt="QR code to sign in with the SecurePay app" className="h-full w-full" /> : <Spinner className="text-sub" />}
      </div>
      {status === 'expired' && <Alert kind="warn">This code expired. Reload the page for a new one.</Alert>}
      {status === 'error' && <Alert>Could not start QR sign-in.</Alert>}
      <ol className="space-y-1 text-left text-sm text-sub">
        <li>1. Open SecurePay on your phone</li>
        <li>2. Go to Security → Scan to sign in</li>
        <li>3. Point your camera at this code and approve</li>
      </ol>
    </div>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') || '/dashboard';
  const [mode, setMode] = useState<'password' | 'qr'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const finish = (t: TokenResponse) => {
    setSession(t);
    router.replace(t.user.role === 'admin' && next === '/dashboard' ? '/admin' : next);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mfaToken) {
        finish(await api('/auth/mfa/verify', { body: { mfaToken, code }, auth: false }));
      } else {
        const r = await api('/auth/login', { body: { email, password, deviceId: deviceId() }, auth: false });
        if (r.mfaRequired) setMfaToken(r.mfaToken);
        else finish(r);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard>
      <h1 className="text-xl font-semibold">{mfaToken ? 'Two-factor authentication' : 'Welcome back'}</h1>
      <p className="mt-1 text-sm text-sub">{mfaToken ? 'Enter the 6-digit code from your authenticator app.' : 'Sign in to your wallet.'}</p>

      {!mfaToken && (
        <div className="mt-5 grid grid-cols-2 rounded-xl bg-muted p-1 text-sm font-medium" role="tablist">
          {(['password', 'qr'] as const).map((m) => (
            <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={`rounded-lg py-2 ${mode === m ? 'bg-surface shadow-sm' : 'text-sub'}`}>
              {m === 'password' ? 'Email & password' : 'Scan QR code'}
            </button>
          ))}
        </div>
      )}

      <div className="mt-5">
        {mode === 'qr' && !mfaToken ? (
          <QrLogin onDone={finish} />
        ) : (
          <form onSubmit={submit} className="space-y-4">
            {mfaToken ? (
              <input autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="input text-center text-lg tracking-[0.4em]" placeholder="000000" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} aria-label="Authenticator code" />
            ) : (
              <>
                <div>
                  <label className="label" htmlFor="email">Email</label>
                  <input id="email" type="email" autoComplete="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div>
                  <label className="label" htmlFor="password">Password</label>
                  <input id="password" type="password" autoComplete="current-password" required className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
              </>
            )}
            {error && <Alert>{error}</Alert>}
            <button className="btn-primary w-full" disabled={busy}>
              {busy && <Spinner />} {mfaToken ? 'Verify' : 'Sign in'}
            </button>
            {mfaToken && (
              <button type="button" className="w-full text-sm text-sub hover:text-ink" onClick={() => { setMfaToken(null); setCode(''); }}>
                Back
              </button>
            )}
          </form>
        )}
      </div>
      <p className="mt-6 text-center text-sm text-sub">
        New to SecurePay? <Link href="/register" className="font-semibold text-brand">Create an account</Link>
      </p>
    </AuthCard>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

