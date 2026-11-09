'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, errorMessage, Spinner } from '@/components/ui';
import { api, CURRENCIES, setSession } from '@/lib/api';

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', password: '', baseCurrency: 'USD' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const body: Record<string, string> = { ...form };
      if (!body.phone) delete body.phone;
      setSession(await api('/auth/register', { body, auth: false }));
      router.replace('/dashboard');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2 text-xl font-bold">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand text-brand-ink">S</span>
          SecurePay
        </div>
        <form onSubmit={submit} className="card space-y-4 p-6 sm:p-8">
          <div>
            <h1 className="text-xl font-semibold">Create your wallet</h1>
            <p className="mt-1 text-sm text-sub">It takes less than a minute.</p>
          </div>
          <div>
            <label className="label" htmlFor="fullName">Full name</label>
            <input id="fullName" required autoComplete="name" className="input" value={form.fullName} onChange={set('fullName')} />
          </div>
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" type="email" required autoComplete="email" className="input" value={form.email} onChange={set('email')} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_7rem]">
            <div>
              <label className="label" htmlFor="phone">Phone (optional)</label>
              <input id="phone" type="tel" autoComplete="tel" placeholder="+923001234567" className="input" value={form.phone} onChange={set('phone')} />
            </div>
            <div>
              <label className="label" htmlFor="currency">Currency</label>
              <select id="currency" className="input" value={form.baseCurrency} onChange={set('baseCurrency')}>
                {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <input id="password" type="password" required minLength={8} autoComplete="new-password" className="input" value={form.password} onChange={set('password')} />
            <p className="mt-1 text-xs text-faint">At least 8 characters, with a letter and a number.</p>
          </div>
          {error && <Alert>{error}</Alert>}
          <button className="btn-primary w-full" disabled={busy}>
            {busy && <Spinner />} Create account
          </button>
          <p className="text-center text-sm text-sub">
            Already have an account? <Link href="/login" className="font-semibold text-brand">Sign in</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
