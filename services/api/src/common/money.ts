import { BadRequestException } from '@nestjs/common';

/** Supported currencies with their minor-unit exponent and ISO 4217 numeric code. */
export const CURRENCIES: Record<string, { exponent: number; numeric: string; name: string }> = {
  USD: { exponent: 2, numeric: '840', name: 'US Dollar' },
  EUR: { exponent: 2, numeric: '978', name: 'Euro' },
  GBP: { exponent: 2, numeric: '826', name: 'British Pound' },
  PKR: { exponent: 2, numeric: '586', name: 'Pakistani Rupee' },
  AED: { exponent: 2, numeric: '784', name: 'UAE Dirham' },
  INR: { exponent: 2, numeric: '356', name: 'Indian Rupee' },
  JPY: { exponent: 0, numeric: '392', name: 'Japanese Yen' },
};

export const SUPPORTED_CURRENCIES = Object.keys(CURRENCIES);

export function assertCurrency(code: string): string {
  const upper = (code ?? '').toUpperCase();
  if (!CURRENCIES[upper]) throw new BadRequestException(`Unsupported currency ${code}`);
  return upper;
}

/** Converts a decimal string/number ("12.34") to minor units (1234) without float drift. */
export function toMinor(amount: string | number, currency: string): number {
  const exp = CURRENCIES[assertCurrency(currency)].exponent;
  const str = typeof amount === 'number' ? amount.toFixed(exp) : amount.trim();
  if (!/^\d+(\.\d+)?$/.test(str)) throw new BadRequestException('Amount must be a positive decimal');
  const [whole, frac = ''] = str.split('.');
  if (frac.length > exp) throw new BadRequestException(`Too many decimal places for ${currency}`);
  const minor = Number(whole) * 10 ** exp + Number(frac.padEnd(exp, '0') || '0');
  if (!Number.isSafeInteger(minor)) throw new BadRequestException('Amount too large');
  return minor;
}

export function fromMinor(minor: number | string, currency: string): string {
  const exp = CURRENCIES[currency]?.exponent ?? 2;
  const n = Number(minor);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (exp === 0) return `${sign}${abs}`;
  const s = abs.toString().padStart(exp + 1, '0');
  return `${sign}${s.slice(0, -exp)}.${s.slice(-exp)}`;
}
