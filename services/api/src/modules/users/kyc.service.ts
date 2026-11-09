import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AuditService } from '../../common/audit.service';
import { config } from '../../config';
import { DbService } from '../../common/db.service';
import { fromMinor } from '../../common/money';
import { NotificationsService } from '../../common/notifications.service';

/**
 * Identity verification. In production, replace verifyWithProvider() with a call to a KYC vendor
 * (Onfido, Sumsub, Veriff...) and handle its webhook. Only the last 4 characters of the ID number
 * are stored here; the full document stays with the vendor.
 */
@Injectable()
export class KycService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  private async verifyWithProvider(dto: { fullName: string; dateOfBirth: string }) {
    const age = (Date.now() - new Date(dto.dateOfBirth).getTime()) / (365.25 * 24 * 3600 * 1000);
    if (age < 18) return { status: 'rejected' as const, reason: 'You must be 18 or older to verify.' };
    return { status: 'approved' as const, reference: `kyc_${randomUUID()}` };
  }

  async submit(
    userId: string,
    dto: { fullName: string; dateOfBirth: string; country: string; idType: string; idNumber: string },
    ip?: string,
  ) {
    const user = await this.db.one('SELECT kyc_level FROM users WHERE id = $1', [userId]);
    if (user.kyc_level >= 1) throw new BadRequestException('Identity already verified');
    const result = await this.verifyWithProvider(dto);
    await this.db.tx(async (client) => {
      await client.query(
        `INSERT INTO kyc_submissions (user_id, full_name, date_of_birth, country, id_type, id_number_last4, status, provider_ref)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [userId, dto.fullName, dto.dateOfBirth, dto.country, dto.idType, dto.idNumber.slice(-4), result.status, 'reference' in result ? result.reference : null],
      );
      if (result.status === 'approved') {
        await client.query('UPDATE users SET kyc_level = 1, updated_at = now() WHERE id = $1', [userId]);
        await this.notifications.notify(
          userId,
          'Identity verified',
          `You can now send up to $${fromMinor(config.kycDailyLimitsUsd[1], 'USD')} a day and withdraw to your bank.`,
          client,
        );
      }
      await this.audit.log('kyc.submitted', { actorId: userId, ip, metadata: { status: result.status } }, client);
    });
    if (result.status === 'rejected') throw new BadRequestException(result.reason);
    return this.status(userId);
  }

  async status(userId: string) {
    const user = await this.db.one('SELECT kyc_level FROM users WHERE id = $1', [userId]);
    const last = await this.db.one(
      'SELECT status, created_at FROM kyc_submissions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
      [userId],
    );
    return {
      level: user.kyc_level,
      dailyLimitUsd: fromMinor(config.kycDailyLimitsUsd[user.kyc_level], 'USD'),
      lastSubmission: last ? { status: last.status, submittedAt: last.created_at } : null,
    };
  }
}
