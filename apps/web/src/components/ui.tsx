'use client';

import { ReactNode, useCallback, useRef, useState } from 'react';
import { ApiError, formatMoney } from '@/lib/api';

export function Alert({ kind = 'error', children }: { kind?: 'error' | 'success' | 'info' | 'warn'; children: ReactNode }) {
  const styles = {
    error: 'border-bad/30 bg-bad/10 text-bad',
    success: 'border-good/30 bg-good/10 text-good',
    warn: 'border-warn/30 bg-warn/10 text-warn',
    info: 'border-line bg-muted text-sub',
  }[kind];
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`rounded-xl border px-3.5 py-2.5 text-sm ${styles}`}>
      {children}
    </div>
  );
}

export function Spinner({ className = '' }: { className?: string }) {
  return <span aria-hidden className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`} />;
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="h1">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-sub">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-faint">{children}</div>;
}

const kindLabel: Record<string, string> = {
  deposit: 'Top-up',
  withdrawal: 'Withdrawal',
  transfer: 'Transfer',
  fx: 'Exchange',
  qr_payment: 'QR payment',
  hold_release: 'Transfer',
  hold_reversal: 'Refund',
};

export interface Tx {
  id: string;
  kind: string;
  status: string;
  description: string | null;
  direction: 'in' | 'out';
  amount: string;
  currency: string;
  counterparty: string | null;
  note: string | null;
  createdAt: string;
}

export function TxList({ items }: { items: Tx[] }) {
  if (!items.length) return <Empty>No transactions yet. Add money to get started.</Empty>;
  return (
    <ul className="divide-y divide-line">
      {items.map((t) => {
        const incoming = t.direction === 'in';
        return (
          <li key={`${t.id}-${t.currency}`} className="flex items-center gap-3 py-3">
            <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-semibold ${incoming ? 'bg-good/10 text-good' : 'bg-muted text-sub'}`} aria-hidden>
              {incoming ? '↓' : '↑'}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{t.counterparty ?? t.description ?? kindLabel[t.kind]}</p>
              <p className="truncate text-xs text-faint">
                {kindLabel[t.kind] ?? t.kind}
                {t.note ? ` · ${t.note}` : ''} · {new Date(t.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </p>
            </div>
            <div className="text-right">
              <p className={`tabular text-sm font-semibold ${incoming ? 'text-good' : ''}`}>
                {incoming ? '+' : '−'}
                {formatMoney(Math.abs(Number(t.amount)), t.currency)}
              </p>
              {t.status !== 'completed' && (
                <span className={`badge ${t.status === 'held' ? 'bg-warn/15 text-warn' : 'bg-bad/15 text-bad'}`}>{t.status === 'held' ? 'Under review' : 'Declined'}</span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Runs an action that may need a step-up MFA code. If the API answers MFA_REQUIRED,
 * shows a code prompt and retries with the code.
 */
export function useMfa() {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const resolver = useRef<((code: string | null) => void) | null>(null);

  const ask = useCallback((why: string) => {
    setReason(why);
    setCode('');
    setError('');
    setOpen(true);
    return new Promise<string | null>((resolve) => (resolver.current = resolve));
  }, []);

  const run = useCallback(
    async <T,>(fn: (mfaCode?: string) => Promise<T>): Promise<T | null> => {
      try {
        return await fn();
      } catch (err) {
        if (!(err instanceof ApiError) || err.code !== 'MFA_REQUIRED') throw err;
        let why = err.body?.reason === 'risk' ? 'This payment looks unusual, so we need to confirm it’s you.' : 'Large payments need your authenticator code.';
        for (;;) {
          const c = await ask(why);
          if (!c) return null;
          try {
            const result = await fn(c);
            setOpen(false);
            return result;
          } catch (e) {
            if (e instanceof ApiError && (e.status === 401 || e.code === 'MFA_REQUIRED')) {
              why = e.message;
              continue;
            }
            setOpen(false);
            throw e;
          }
        }
      }
    },
    [ask],
  );

  const modal = open ? (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal aria-labelledby="mfa-title">
      <form
        className="card w-full max-w-sm space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!/^\d{6}$/.test(code)) return setError('Enter the 6-digit code.');
          resolver.current?.(code);
        }}
      >
        <div>
          <h2 id="mfa-title" className="text-lg font-semibold">Confirm it’s you</h2>
          <p className="mt-1 text-sm text-sub">{reason}</p>
        </div>
        <input
          autoFocus
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          className="input text-center text-lg tracking-[0.4em]"
          placeholder="000000"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          aria-label="Authenticator code"
        />
        {error && <Alert>{error}</Alert>}
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-ghost flex-1"
            onClick={() => {
              setOpen(false);
              resolver.current?.(null);
            }}
          >
            Cancel
          </button>
          <button className="btn-primary flex-1">Confirm</button>
        </div>
      </form>
    </div>
  ) : null;

  return { run, modal };
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return 'Something went wrong. Please try again.';
}
