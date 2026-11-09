import { Injectable, Logger } from '@nestjs/common';
import { config } from '../../config';
import { assertCurrency, CURRENCIES, SUPPORTED_CURRENCIES } from '../../common/money';

/** Fallback mid-market rates (units of currency per 1 USD). Used when no live feed is configured or reachable. */
const DEFAULT_RATES: Record<string, number> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  PKR: 280.5,
  AED: 3.6725,
  INR: 83.4,
  JPY: 151.2,
};

@Injectable()
export class FxService {
  private readonly logger = new Logger('FX');
  private rates: Record<string, number> = { ...DEFAULT_RATES };
  private source = 'built-in';
  private fetchedAt = 0;
  private readonly ttlMs = 60 * 60 * 1000;

  /** Lazily refreshes rates from FX_RATES_URL (expects { rates: { EUR: 0.92, ... } } relative to USD). */
  async getRates() {
    if (config.fxRatesUrl && Date.now() - this.fetchedAt > this.ttlMs) {
      this.fetchedAt = Date.now();
      try {
        const res = await fetch(config.fxRatesUrl, { signal: AbortSignal.timeout(3000) });
        const body: any = await res.json();
        const next: Record<string, number> = { USD: 1 };
        for (const cur of SUPPORTED_CURRENCIES) {
          const r = Number(body?.rates?.[cur]);
          if (r > 0) next[cur] = r;
        }
        if (Object.keys(next).length === SUPPORTED_CURRENCIES.length) {
          this.rates = next;
          this.source = new URL(config.fxRatesUrl).host;
        }
      } catch (err) {
        this.logger.warn(`FX refresh failed, keeping ${this.source} rates: ${(err as Error).message}`);
      }
    }
    return { base: 'USD', source: this.source, rates: { ...this.rates } };
  }

  /** Mid-market rate for 1 unit of `from` expressed in `to`. */
  async rate(from: string, to: string): Promise<number> {
    const { rates } = await this.getRates();
    return rates[assertCurrency(to)] / rates[assertCurrency(from)];
  }

  /** Converts minor units between currencies at mid-market rate, rounding down. */
  async convertMinor(amountMinor: number, from: string, to: string): Promise<number> {
    if (from === to) return amountMinor;
    const r = await this.rate(from, to);
    const major = amountMinor / 10 ** CURRENCIES[from].exponent;
    return Math.floor(major * r * 10 ** CURRENCIES[to].exponent);
  }

  /** Quote for a customer conversion, applying the FX spread as a fee taken in the source currency. */
  async quote(amountMinor: number, from: string, to: string) {
    const fromCur = assertCurrency(from);
    const toCur = assertCurrency(to);
    const feeMinor = Math.ceil((amountMinor * config.fxSpreadBps) / 10_000);
    const netMinor = amountMinor - feeMinor;
    const rate = await this.rate(fromCur, toCur);
    const receiveMinor = await this.convertMinor(netMinor, fromCur, toCur);
    return { from: fromCur, to: toCur, rate, amountMinor, feeMinor, netMinor, receiveMinor };
  }
}
