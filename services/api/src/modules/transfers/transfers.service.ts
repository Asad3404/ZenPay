import { BadRequestException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../common/audit.service';
import { config } from '../../config';
import { DbService } from '../../common/db.service';
import { AppError, MfaRequired } from '../../common/errors';
import { assertCurrency, fromMinor } from '../../common/money';
import { NotificationsService } from '../../common/notifications.service';
import { AuthService } from '../auth/auth.service';
import { FraudAssessment, FraudService } from '../fraud/fraud.service';
import { FxService } from '../fx/fx.service';
import { LedgerService } from '../ledger/ledger.service';

export interface SendInput {
  senderId: string;
  recipientId: string;
  amountMinor: number;
  currency: string;
  note?: string;
  idempotencyKey: string;
  mfaCode?: string;
  deviceId?: string;
  ip?: string;
  kind?: 'transfer' | 'qr_payment';
  metadata?: Record<string, unknown>;
}

@Injectable()
export class TransfersService {
  constructor(
    private readonly db: DbService,
    private readonly ledger: LedgerService,
    private readonly fx: FxService,
    private readonly fraud: FraudService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async lookupRecipient(query: string, requesterId: string) {
    const q = query.trim().toLowerCase();
    const user = await this.db.one(
      `SELECT id, full_name, email, status FROM users WHERE (email = $1 OR phone = $2) AND id <> $3`,
      [q, query.trim(), requesterId],
    );
    if (!user || user.status !== 'active') throw new NotFoundException('No SecurePay user found');
    const [name, domain] = user.email.split('@');
    return { id: user.id, fullName: user.full_name, maskedEmail: `${name.slice(0, 2)}***@${domain}` };
  }

  /** USD amount sent in the last 24h, used for KYC limits. */
  async sentLast24hUsd(userId: string): Promise<number> {
    const row = await this.db.one(
      `SELECT COALESCE(sum((metadata->>'amountUsdMinor')::bigint), 0) AS s FROM journal_entries
        WHERE initiated_by = $1 AND kind IN ('transfer', 'qr_payment', 'withdrawal')
          AND status <> 'rejected' AND created_at > now() - interval '24 hours'`,
      [userId],
    );
    return Number(row.s);
  }

  async assertWithinLimit(userId: string, amountUsdMinor: number) {
    const user = await this.db.one('SELECT kyc_level FROM users WHERE id = $1', [userId]);
    const limit = config.kycDailyLimitsUsd[user.kyc_level];
    const used = await this.sentLast24hUsd(userId);
    if (used + amountUsdMinor > limit) {
      throw new AppError(
        HttpStatus.FORBIDDEN,
        'LIMIT_EXCEEDED',
        `Daily limit of $${fromMinor(limit, 'USD')} reached for verification level ${user.kyc_level}. Complete identity verification to raise it.`,
        { limitUsd: fromMinor(limit, 'USD'), usedUsd: fromMinor(used, 'USD') },
      );
    }
  }

  /**
   * Runs fraud checks and MFA step-up. Returns the assessment, possibly escalated to 'review'.
   * Throws for blocked payments (after recording the case) and when an MFA code is needed.
   */
  async screen(
    userId: string,
    kind: 'transfer' | 'qr_payment' | 'withdrawal',
    amountUsdMinor: number,
    opts: { recipientId?: string; deviceId?: string; mfaCode?: string; ip?: string; context: Record<string, unknown> },
  ): Promise<FraudAssessment> {
    const assessment = await this.fraud.assess({ userId, kind, amountUsdMinor, recipientId: opts.recipientId, deviceId: opts.deviceId });
    if (assessment.decision === 'block') {
      await this.fraud.recordCase(this.db.pool, userId, assessment, 'rejected', null, opts.context);
      await this.audit.log('fraud.blocked', { actorId: userId, ip: opts.ip, metadata: { score: assessment.score, reasons: assessment.reasons } });
      throw new AppError(HttpStatus.FORBIDDEN, 'PAYMENT_BLOCKED', 'This payment was blocked by our security checks. Contact support if this is a mistake.');
    }
    const needsStepUp = assessment.decision === 'challenge' || amountUsdMinor >= config.stepUpThresholdUsd;
    if (needsStepUp) {
      if (await this.auth.hasMfa(userId)) {
        if (!opts.mfaCode) throw MfaRequired(assessment.decision === 'challenge' ? 'risk' : 'amount');
        await this.auth.assertMfaCode(userId, opts.mfaCode);
      } else if (assessment.decision === 'challenge') {
        // Without MFA we cannot verify the user, so hold the payment for manual review instead.
        assessment.decision = 'review';
        assessment.reasons.push('Two-factor authentication is not enabled');
      } else {
        throw new AppError(HttpStatus.FORBIDDEN, 'MFA_SETUP_REQUIRED', `Turn on two-factor authentication to send $${fromMinor(config.stepUpThresholdUsd, 'USD')} or more.`);
      }
    }
    return assessment;
  }

  async send(input: SendInput) {
    const currency = assertCurrency(input.currency);
    const kind = input.kind ?? 'transfer';
    if (input.senderId === input.recipientId) throw new BadRequestException('You cannot send money to yourself');
    if (input.amountMinor <= 0) throw new BadRequestException('Amount must be greater than zero');

    const existing = await this.ledger.findByIdempotencyKey(input.senderId, input.idempotencyKey);
    if (existing) return this.present(existing, true);

    const [sender, recipient] = await Promise.all([
      this.db.one('SELECT id, full_name FROM users WHERE id = $1', [input.senderId]),
      this.db.one('SELECT id, full_name, status FROM users WHERE id = $1', [input.recipientId]),
    ]);
    if (!recipient || recipient.status !== 'active') throw new NotFoundException('Recipient not found');

    const amountUsdMinor = await this.fx.convertMinor(input.amountMinor, currency, 'USD');
    await this.assertWithinLimit(input.senderId, amountUsdMinor);
    const assessment = await this.screen(input.senderId, kind, amountUsdMinor, {
      recipientId: input.recipientId,
      deviceId: input.deviceId,
      mfaCode: input.mfaCode,
      ip: input.ip,
      context: { kind, amountMinor: input.amountMinor, currency, recipientId: input.recipientId },
    });
    const held = assessment.decision === 'review';

    const entry = await this.db.tx(async (client) => {
      const from = await this.ledger.getOrCreateWallet(input.senderId, currency, client);
      const to = held
        ? await this.ledger.systemAccount('holds', currency, client)
        : await this.ledger.getOrCreateWallet(input.recipientId, currency, client);
      const e = await this.ledger.post(client, {
        kind,
        status: held ? 'held' : 'completed',
        description: input.note || (kind === 'qr_payment' ? `QR payment to ${recipient.full_name}` : `Transfer to ${recipient.full_name}`),
        initiatedBy: input.senderId,
        idempotencyKey: input.idempotencyKey,
        metadata: {
          ...input.metadata,
          recipientId: recipient.id,
          recipientName: recipient.full_name,
          senderId: sender.id,
          senderName: sender.full_name,
          note: input.note ?? null,
          amountUsdMinor,
          fraudScore: assessment.score,
        },
        postings: [
          { accountId: from.id, amount: -input.amountMinor, currency },
          { accountId: to.id, amount: input.amountMinor, currency },
        ],
      });
      if (e.replayed) return e;
      const display = `${fromMinor(input.amountMinor, currency)} ${currency}`;
      if (held) {
        await this.fraud.recordCase(client, input.senderId, assessment, 'open', e.id, { kind, recipientId: recipient.id });
        await this.notifications.notify(input.senderId, 'Payment under review', `Your payment of ${display} to ${recipient.full_name} is being reviewed for your security. We'll notify you shortly.`, client);
      } else {
        if (assessment.decision !== 'allow') {
          await this.fraud.recordCase(client, input.senderId, assessment, 'logged', e.id, { kind, recipientId: recipient.id, mfaVerified: true });
        }
        await this.notifications.notify(recipient.id, 'Money received', `${sender.full_name} sent you ${display}.`, client);
      }
      await this.audit.log(`payment.${kind}`, { actorId: input.senderId, ip: input.ip, target: e.id, metadata: { amountUsdMinor, held, score: assessment.score } }, client);
      return e;
    });
    return { ...this.present(entry, !!entry.replayed), fraud: { score: assessment.score, decision: assessment.decision, reasons: assessment.reasons } };
  }

  /** Admin: release a held payment to its recipient. */
  async releaseHeld(entryId: string, adminId: string) {
    return this.db.tx(async (client) => {
      const { rows } = await client.query(`SELECT * FROM journal_entries WHERE id = $1 FOR UPDATE`, [entryId]);
      const entry = rows[0];
      if (!entry || entry.status !== 'held') throw new BadRequestException('Payment is not on hold');
      const { rows: p } = await client.query(`SELECT amount, currency FROM postings WHERE entry_id = $1 AND amount > 0`, [entryId]);
      const { amount, currency } = p[0];
      const holds = await this.ledger.systemAccount('holds', currency, client);
      const to = await this.ledger.getOrCreateWallet(entry.metadata.recipientId, currency, client);
      await this.ledger.post(client, {
        kind: 'hold_release',
        parentId: entryId,
        description: entry.description,
        metadata: { ...entry.metadata, releasedBy: adminId },
        postings: [
          { accountId: holds.id, amount: -Number(amount), currency },
          { accountId: to.id, amount: Number(amount), currency },
        ],
      });
      await client.query(`UPDATE journal_entries SET status = 'completed' WHERE id = $1`, [entryId]);
      const display = `${fromMinor(amount, currency)} ${currency}`;
      await this.notifications.notify(entry.metadata.recipientId, 'Money received', `${entry.metadata.senderName} sent you ${display}.`, client);
      await this.notifications.notify(entry.initiated_by, 'Payment approved', `Your payment of ${display} to ${entry.metadata.recipientName} was approved and delivered.`, client);
      return { id: entryId, status: 'completed' };
    });
  }

  /** Admin: reject a held payment and return funds to the sender. */
  async reverseHeld(entryId: string, adminId: string) {
    return this.db.tx(async (client) => {
      const { rows } = await client.query(`SELECT * FROM journal_entries WHERE id = $1 FOR UPDATE`, [entryId]);
      const entry = rows[0];
      if (!entry || entry.status !== 'held') throw new BadRequestException('Payment is not on hold');
      const { rows: p } = await client.query(`SELECT amount, currency FROM postings WHERE entry_id = $1 AND amount > 0`, [entryId]);
      const { amount, currency } = p[0];
      const holds = await this.ledger.systemAccount('holds', currency, client);
      const back = await this.ledger.getOrCreateWallet(entry.initiated_by, currency, client);
      await this.ledger.post(client, {
        kind: 'hold_reversal',
        parentId: entryId,
        description: `Refund: ${entry.description}`,
        metadata: { ...entry.metadata, reversedBy: adminId, counterpartyName: 'SecurePay Security' },
        postings: [
          { accountId: holds.id, amount: -Number(amount), currency },
          { accountId: back.id, amount: Number(amount), currency },
        ],
      });
      await client.query(`UPDATE journal_entries SET status = 'rejected' WHERE id = $1`, [entryId]);
      await this.notifications.notify(entry.initiated_by, 'Payment declined', `Your payment of ${fromMinor(amount, currency)} ${currency} was declined after review and the money is back in your wallet.`, client);
      return { id: entryId, status: 'rejected' };
    });
  }

  private present(entry: any, replayed: boolean) {
    const m = entry.metadata ?? {};
    return {
      id: entry.id,
      kind: entry.kind,
      status: entry.status,
      description: entry.description,
      recipient: m.recipientId ? { id: m.recipientId, fullName: m.recipientName } : null,
      createdAt: entry.created_at,
      replayed,
    };
  }
}
