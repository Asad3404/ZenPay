import { BadRequestException, HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit.service';
import { DbService } from '../../common/db.service';
import { AppError } from '../../common/errors';
import { assertCurrency, fromMinor } from '../../common/money';
import { NotificationsService } from '../../common/notifications.service';
import { FxService } from '../fx/fx.service';
import { LedgerService } from '../ledger/ledger.service';
import { TransfersService } from '../transfers/transfers.service';
import { PaymentProvider } from './payment-provider';

@Injectable()
export class WalletsService {
  constructor(
    private readonly db: DbService,
    private readonly ledger: LedgerService,
    private readonly fx: FxService,
    private readonly transfers: TransfersService,
    private readonly provider: PaymentProvider,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async overview(userId: string) {
    const balances = await this.ledger.balances(userId);
    const user = await this.db.one('SELECT base_currency FROM users WHERE id = $1', [userId]);
    let totalMinor = 0;
    for (const b of balances) totalMinor += await this.fx.convertMinor(b.balanceMinor, b.currency, user.base_currency);
    return {
      baseCurrency: user.base_currency,
      totalInBase: fromMinor(totalMinor, user.base_currency),
      wallets: balances,
    };
  }

  async openWallet(userId: string, currency: string) {
    const w = await this.ledger.getOrCreateWallet(userId, currency);
    return { accountId: w.id, currency: w.currency, balance: fromMinor(w.balance, w.currency) };
  }

  /** Add money from an external card/bank via the payment provider (sandbox by default). */
  async deposit(userId: string, amountMinor: number, currency: string, idempotencyKey: string, ip?: string) {
    const cur = assertCurrency(currency);
    const usd = await this.fx.convertMinor(amountMinor, cur, 'USD');
    if (usd > 10_000_00) throw new BadRequestException('Maximum single top-up is the equivalent of $10,000');
    const existing = await this.ledger.findByIdempotencyKey(userId, idempotencyKey);
    if (existing) return { id: existing.id, status: existing.status, replayed: true };

    const charge = await this.provider.charge({ userId, amountMinor, currency: cur, idempotencyKey });
    if (charge.status !== 'succeeded') {
      throw new AppError(HttpStatus.PAYMENT_REQUIRED, 'CHARGE_FAILED', charge.failureReason ?? 'Payment was declined');
    }
    return this.db.tx(async (client) => {
      const funding = await this.ledger.systemAccount('funding', cur, client);
      const wallet = await this.ledger.getOrCreateWallet(userId, cur, client);
      const e = await this.ledger.post(client, {
        kind: 'deposit',
        description: `Top-up via ${charge.provider}`,
        initiatedBy: userId,
        idempotencyKey,
        metadata: { providerRef: charge.reference, provider: charge.provider, counterpartyName: 'Card top-up', amountUsdMinor: usd },
        postings: [
          { accountId: funding.id, amount: -amountMinor, currency: cur },
          { accountId: wallet.id, amount: amountMinor, currency: cur },
        ],
      });
      await this.audit.log('wallet.deposit', { actorId: userId, ip, target: e.id, metadata: { amountMinor, currency: cur } }, client);
      return { id: e.id, status: e.status, amount: fromMinor(amountMinor, cur), currency: cur, replayed: !!e.replayed };
    });
  }

  /** Send money out to the user's bank account. Requires verified identity. */
  async withdraw(userId: string, amountMinor: number, currency: string, idempotencyKey: string, mfaCode?: string, deviceId?: string, ip?: string) {
    const cur = assertCurrency(currency);
    const user = await this.db.one('SELECT kyc_level FROM users WHERE id = $1', [userId]);
    if (user.kyc_level < 1) {
      throw new AppError(HttpStatus.FORBIDDEN, 'KYC_REQUIRED', 'Verify your identity before withdrawing to a bank account.');
    }
    const existing = await this.ledger.findByIdempotencyKey(userId, idempotencyKey);
    if (existing) return { id: existing.id, status: existing.status, replayed: true };
    const usd = await this.fx.convertMinor(amountMinor, cur, 'USD');
    await this.transfers.assertWithinLimit(userId, usd);
    const assessment = await this.transfers.screen(userId, 'withdrawal', usd, {
      deviceId,
      mfaCode,
      ip,
      context: { kind: 'withdrawal', amountMinor, currency: cur },
    });
    if (assessment.decision === 'review') {
      throw new AppError(HttpStatus.FORBIDDEN, 'REVIEW_REQUIRED', 'This withdrawal needs a security review. Please contact support or try a smaller amount.');
    }
    const entry = await this.db.tx(async (client) => {
      const funding = await this.ledger.systemAccount('funding', cur, client);
      const wallet = await this.ledger.getOrCreateWallet(userId, cur, client);
      const e = await this.ledger.post(client, {
        kind: 'withdrawal',
        description: 'Withdrawal to bank account',
        initiatedBy: userId,
        idempotencyKey,
        metadata: { amountUsdMinor: usd, counterpartyName: 'Bank account', fraudScore: assessment.score },
        postings: [
          { accountId: wallet.id, amount: -amountMinor, currency: cur },
          { accountId: funding.id, amount: amountMinor, currency: cur },
        ],
      });
      await this.audit.log('wallet.withdrawal', { actorId: userId, ip, target: e.id, metadata: { amountMinor, currency: cur } }, client);
      return e;
    });
    const payout = await this.provider.payout({ userId, amountMinor, currency: cur, idempotencyKey });
    return { id: entry.id, status: entry.status, payoutReference: payout.reference, amount: fromMinor(amountMinor, cur), currency: cur };
  }

  /** Convert between the user's own currency wallets. The spread is booked to the fees account. */
  async convert(userId: string, amountMinor: number, from: string, to: string, idempotencyKey: string, ip?: string) {
    const q = await this.fx.quote(amountMinor, from, to);
    if (q.from === q.to) throw new BadRequestException('Choose two different currencies');
    if (q.receiveMinor <= 0 || q.netMinor <= 0) throw new BadRequestException('Amount too small to convert');
    const entry = await this.db.tx(async (client) => {
      const src = await this.ledger.getOrCreateWallet(userId, q.from, client);
      const dst = await this.ledger.getOrCreateWallet(userId, q.to, client);
      const fxFrom = await this.ledger.systemAccount('fx', q.from, client);
      const fxTo = await this.ledger.systemAccount('fx', q.to, client);
      const fees = await this.ledger.systemAccount('fees', q.from, client);
      const e = await this.ledger.post(client, {
        kind: 'fx',
        description: `Converted ${q.from} to ${q.to}`,
        initiatedBy: userId,
        idempotencyKey,
        metadata: { rate: q.rate, feeMinor: q.feeMinor, from: q.from, to: q.to, counterpartyName: 'Currency exchange' },
        postings: [
          { accountId: src.id, amount: -q.amountMinor, currency: q.from },
          { accountId: fxFrom.id, amount: q.netMinor, currency: q.from },
          ...(q.feeMinor > 0 ? [{ accountId: fees.id, amount: q.feeMinor, currency: q.from }] : []),
          { accountId: fxTo.id, amount: -q.receiveMinor, currency: q.to },
          { accountId: dst.id, amount: q.receiveMinor, currency: q.to },
        ],
      });
      await this.audit.log('wallet.fx', { actorId: userId, ip, target: e.id, metadata: q }, client);
      return e;
    });
    return {
      id: entry.id,
      rate: q.rate,
      sent: `${fromMinor(q.amountMinor, q.from)} ${q.from}`,
      fee: `${fromMinor(q.feeMinor, q.from)} ${q.from}`,
      received: `${fromMinor(q.receiveMinor, q.to)} ${q.to}`,
      replayed: !!entry.replayed,
    };
  }
}
