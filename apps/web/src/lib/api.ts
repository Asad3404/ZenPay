'use client';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  role: 'user' | 'admin';
  mfaEnabled: boolean;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: SessionUser;
}

export class ApiError extends Error {
  constructor(public status: number, public code: string | undefined, message: string, public body: any) {
    super(message);
  }
}

/**
 * Access token lives in memory only. The refresh token is kept in sessionStorage so it
 * disappears when the tab closes (a deliberate trade-off for a money app).
 */
let accessToken: string | null = null;
const listeners = new Set<() => void>();

const storage = {
  get(key: string) {
    try {
      return typeof window === 'undefined' ? null : window.sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string | null) {
    try {
      if (value === null) window.sessionStorage.removeItem(key);
      else window.sessionStorage.setItem(key, value);
    } catch {
      /* storage unavailable */
    }
  },
};

export function deviceId(): string {
  try {
    let id = window.localStorage.getItem('sp_device');
    if (!id) {
      id = crypto.randomUUID();
      window.localStorage.setItem('sp_device', id);
    }
    return id;
  } catch {
    return 'unknown-device';
  }
}

export function getUser(): SessionUser | null {
  const raw = storage.get('sp_user');
  return raw ? (JSON.parse(raw) as SessionUser) : null;
}

export function setSession(t: TokenResponse | null) {
  accessToken = t?.accessToken ?? null;
  storage.set('sp_refresh', t?.refreshToken ?? null);
  storage.set('sp_user', t ? JSON.stringify(t.user) : null);
  listeners.forEach((l) => l());
}

export function updateUser(patch: Partial<SessionUser>) {
  const u = getUser();
  if (u) storage.set('sp_user', JSON.stringify({ ...u, ...patch }));
  listeners.forEach((l) => l());
}

export function onSessionChange(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let refreshing: Promise<boolean> | null = null;

async function refresh(): Promise<boolean> {
  const rt = storage.get('sp_refresh');
  if (!rt) return false;
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: rt }),
      });
      if (!res.ok) {
        setSession(null);
        return false;
      }
      setSession(await res.json());
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing;
}

export async function api<T = any>(path: string, init: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const send = () =>
    fetch(`${API_URL}${path}`, {
      method: init.method ?? (init.body ? 'POST' : 'GET'),
      headers: {
        'content-type': 'application/json',
        'x-device-id': deviceId(),
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });

  if (init.auth !== false && !accessToken) await refresh();
  let res: Response;
  try {
    res = await send();
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach SecurePay. Check your connection.', null);
  }
  if (res.status === 401 && init.auth !== false && (await refresh())) res = await send();
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401 && init.auth !== false) setSession(null);
    const msg = Array.isArray(body?.message) ? body.message.join('. ') : body?.message ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, body?.code, msg, body);
  }
  return body as T;
}

export async function logout() {
  const rt = storage.get('sp_refresh');
  if (rt) await api('/auth/logout', { body: { refreshToken: rt }, auth: false }).catch(() => undefined);
  setSession(null);
}

export async function restoreSession(): Promise<boolean> {
  if (accessToken) return true;
  return refresh();
}

export const newKey = () => crypto.randomUUID();

export function formatMoney(amount: string | number, currency: string) {
  const n = typeof amount === 'string' ? Number(amount) : amount;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: currency === 'JPY' ? 0 : 2 }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'PKR', 'AED', 'INR', 'JPY'];
