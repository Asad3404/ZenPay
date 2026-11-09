'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode, useEffect, useState } from 'react';
import { getUser, logout, onSessionChange, restoreSession, SessionUser } from '@/lib/api';
import { Spinner } from './ui';

const NAV = [
  { href: '/dashboard', label: 'Home', icon: '⌂' },
  { href: '/send', label: 'Send', icon: '↗' },
  { href: '/pay', label: 'QR Pay', icon: '▦' },
  { href: '/wallets', label: 'Wallets', icon: '◫' },
  { href: '/transactions', label: 'Activity', icon: '≡' },
  { href: '/insights', label: 'Insights', icon: '✦' },
  { href: '/security', label: 'Security', icon: '⛨' },
];

export function AppShell({ children, admin = false }: { children: ReactNode; admin?: boolean }) {
  const router = useRouter();
  const path = usePathname();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    restoreSession().then((ok) => {
      if (!alive) return;
      const u = getUser();
      if (!ok || !u) return router.replace(`/login?next=${encodeURIComponent(path)}`);
      if (admin && u.role !== 'admin') return router.replace('/dashboard');
      setUser(u);
      setReady(true);
    });
    const off = onSessionChange(() => {
      const u = getUser();
      if (!u) router.replace('/login');
      else setUser(u);
    });
    return () => {
      alive = false;
      off();
    };
  }, [admin, path, router]);

  if (!ready || !user) {
    return (
      <div className="grid min-h-screen place-items-center text-sub">
        <Spinner />
      </div>
    );
  }

  const nav = admin
    ? [{ href: '/admin', label: 'Overview', icon: '◷' }, { href: '/admin/fraud', label: 'Fraud review', icon: '⚑' }, { href: '/admin/users', label: 'Users', icon: '☺' }, { href: '/admin/transactions', label: 'Ledger', icon: '≡' }, { href: '/admin/audit', label: 'Audit log', icon: '⎙' }]
    : NAV;

  return (
    <div className="min-h-screen md:flex">
      <aside className="border-b border-line bg-surface md:sticky md:top-0 md:flex md:h-screen md:w-60 md:flex-col md:border-b-0 md:border-r">
        <div className="flex items-center justify-between px-5 py-4">
          <Link href={admin ? '/admin' : '/dashboard'} className="flex items-center gap-2 text-lg font-bold tracking-tight">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-brand-ink">S</span>
            SecurePay{admin && <span className="badge bg-muted text-sub">Admin</span>}
          </Link>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-1 md:flex-col md:overflow-visible" aria-label="Main">
          {nav.map((n) => {
            const active = n.href === path || (n.href !== '/admin' && path.startsWith(n.href + '/'));
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? 'page' : undefined}
                className={`flex shrink-0 items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition ${active ? 'bg-brand/10 text-brand' : 'text-sub hover:bg-muted hover:text-ink'}`}
              >
                <span aria-hidden className="w-4 text-center">{n.icon}</span>
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="hidden border-t border-line p-4 md:block">
          <p className="truncate text-sm font-medium">{user.fullName}</p>
          <p className="truncate text-xs text-faint">{user.email}</p>
          <div className="mt-3 flex gap-2">
            {user.role === 'admin' && (
              <Link href={admin ? '/dashboard' : '/admin'} className="btn-ghost flex-1 px-2 py-1.5 text-xs">
                {admin ? 'Wallet' : 'Admin'}
              </Link>
            )}
            <button className="btn-ghost flex-1 px-2 py-1.5 text-xs" onClick={() => logout().then(() => router.replace('/login'))}>
              Log out
            </button>
          </div>
        </div>
      </aside>
      <main className="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-10">
        {children}
        <div className="mt-10 flex gap-2 md:hidden">
          {user.role === 'admin' && (
            <Link href={admin ? '/dashboard' : '/admin'} className="btn-ghost flex-1">
              {admin ? 'Wallet' : 'Admin'}
            </Link>
          )}
          <button className="btn-ghost flex-1" onClick={() => logout().then(() => router.replace('/login'))}>
            Log out
          </button>
        </div>
      </main>
    </div>
  );
}
