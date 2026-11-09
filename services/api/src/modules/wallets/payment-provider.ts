import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';

export interface ChargeRequest {
  userId: string;
  amountMinor: number;
  currency: string;
  idempotencyKey: string;
}

export interface ProviderResult {
  provider: string;
  status: 'succeeded' | 'failed';
  reference: string;
  failureReason?: string;
}

/**
 * Boundary to the licensed bank / payment processor that holds real funds.
 * Swap SandboxPaymentProvider for a Stripe, Adyen or local-bank implementation in production;
 * nothing else in the codebase needs to change.
 */
export abstract class PaymentProvider {
  abstract charge(req: ChargeRequest): Promise<ProviderResult>;
  abstract payout(req: ChargeRequest): Promise<ProviderResult>;
}

/** Simulated processor for development and demos. Amounts ending in .13 are declined, to test failures. */
@Injectable()
export class SandboxPaymentProvider extends PaymentProvider {
  async charge(req: ChargeRequest): Promise<ProviderResult> {
    if (req.amountMinor % 100 === 13) {
      return { provider: 'sandbox', status: 'failed', reference: `ch_${randomUUID()}`, failureReason: 'Card declined (sandbox test amount)' };
    }
    return { provider: 'sandbox', status: 'succeeded', reference: `ch_${randomUUID()}` };
  }

  async payout(_req: ChargeRequest): Promise<ProviderResult> {
    return { provider: 'sandbox', status: 'succeeded', reference: `po_${randomUUID()}` };
  }
}
