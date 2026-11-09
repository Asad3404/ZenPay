import { BadRequestException, Body, Controller, NotFoundException, Get, HttpCode, Ip, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, Max, Min } from 'class-validator';
import { AuditService } from '../../common/audit.service';
import { AuthUser, CurrentUser, Roles } from '../../common/auth';
import { DbService } from '../../common/db.service';
import { fromMinor } from '../../common/money';
import { NotificationsService } from '../../common/notifications.service';
import { TransfersService } from '../transfers/transfers.service';

class StatusDto {
  @ApiProperty({ enum: ['active', 'frozen'] }) @IsIn(['active', 'frozen']) status: 'active' | 'frozen';
}

class KycLevelDto {
  @ApiProperty({ minimum: 0, maximum: 2 }) @IsInt() @Min(0) @Max(2) level: number;
}

@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly db: DbService,
    private readonly transfers: TransfersService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  @Get('stats')
  async stats() {
    const row = await this.db.one(`
      SELECT
        (SELECT count(*) FROM users) AS users,
        (SELECT count(*) FROM users WHERE created_at > now() - interval '7 days') AS new_users_7d,
        (SELECT count(*) FROM users WHERE status = 'frozen') AS frozen_users,
        (SELECT count(*) FROM journal_entries WHERE created_at > now() - interval '24 hours') AS tx_24h,
        (SELECT COALESCE(sum((metadata->>'amountUsdMinor')::bigint), 0) FROM journal_entries
          WHERE kind IN ('transfer', 'qr_payment') AND created_at > now() - interval '24 hours') AS volume_24h_usd,
        (SELECT count(*) FROM fraud_cases WHERE status = 'open') AS open_cases,
        (SELECT count(*) FROM fraud_cases WHERE created_at > now() - interval '24 hours' AND decision = 'block') AS blocked_24h`);
    const daily = await this.db.query(`
      SELECT to_char(d, 'YYYY-MM-DD') AS day,
             COALESCE((SELECT count(*) FROM journal_entries je WHERE je.created_at::date = d::date), 0) AS count,
             COALESCE((SELECT sum((metadata->>'amountUsdMinor')::bigint) FROM journal_entries je
                        WHERE je.created_at::date = d::date AND kind IN ('transfer', 'qr_payment')), 0) AS volume
        FROM generate_series(current_date - 13, current_date, interval '1 day') d ORDER BY d`);
    const fees = await this.db.query(`SELECT currency, balance FROM accounts WHERE type = 'system' AND code = 'fees'`);
    return {
      users: Number(row.users),
      newUsers7d: Number(row.new_users_7d),
      frozenUsers: Number(row.frozen_users),
      transactions24h: Number(row.tx_24h),
      volume24hUsd: fromMinor(row.volume_24h_usd, 'USD'),
      openFraudCases: Number(row.open_cases),
      blocked24h: Number(row.blocked_24h),
      feeRevenue: fees.map((f) => ({ currency: f.currency, amount: fromMinor(f.balance, f.currency) })),
      daily: daily.map((d) => ({ day: d.day, count: Number(d.count), volumeUsd: Number(fromMinor(d.volume, 'USD')) })),
    };
  }

  @Get('users')
  users(@Query('q') q?: string) {
    return this.db.query(
      `SELECT id, email, phone, full_name AS "fullName", role, status, kyc_level AS "kycLevel",
              mfa_enabled AS "mfaEnabled", created_at AS "createdAt"
         FROM users WHERE ($1::text IS NULL OR email ILIKE '%' || $1 || '%' OR full_name ILIKE '%' || $1 || '%')
        ORDER BY created_at DESC LIMIT 100`,
      [q || null],
    );
  }

  @Patch('users/:id/status')
  async setStatus(@CurrentUser() admin: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StatusDto, @Ip() ip: string) {
    await this.db.query('UPDATE users SET status = $2, updated_at = now() WHERE id = $1 AND role <> $3', [id, dto.status, 'admin']);
    if (dto.status === 'frozen') await this.db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [id]);
    await this.audit.log(`admin.user_${dto.status}`, { actorId: admin.id, target: id, ip });
    return { id, status: dto.status };
  }

  @Patch('users/:id/kyc')
  async setKyc(@CurrentUser() admin: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: KycLevelDto, @Ip() ip: string) {
    await this.db.query('UPDATE users SET kyc_level = $2, updated_at = now() WHERE id = $1', [id, dto.level]);
    await this.notifications.notify(id, 'Verification level updated', `Your account is now at verification level ${dto.level}.`);
    await this.audit.log('admin.kyc_level', { actorId: admin.id, target: id, ip, metadata: { level: dto.level } });
    return { id, kycLevel: dto.level };
  }

  @Get('transactions')
  async transactions(@Query('status') status?: string) {
    const rows = await this.db.query(
      `SELECT je.id, je.kind, je.status, je.description, je.metadata, je.created_at, u.email AS initiator,
              (SELECT json_agg(json_build_object('amount', p.amount, 'currency', p.currency)) FROM postings p WHERE p.entry_id = je.id AND p.amount > 0) AS credits
         FROM journal_entries je LEFT JOIN users u ON u.id = je.initiated_by
        WHERE ($1::text IS NULL OR je.status = $1)
        ORDER BY je.created_at DESC LIMIT 200`,
      [status || null],
    );
    return rows.map((r) => {
      const c = r.credits?.[0];
      return {
        id: r.id,
        kind: r.kind,
        status: r.status,
        description: r.description,
        initiator: r.initiator,
        amount: c ? fromMinor(c.amount, c.currency) : null,
        currency: c?.currency ?? null,
        fraudScore: r.metadata?.fraudScore ?? null,
        createdAt: r.created_at,
      };
    });
  }

  @Get('fraud-cases')
  async fraudCases(@Query('status') status?: string) {
    const rows = await this.db.query(
      `SELECT fc.*, u.email, u.full_name,
              (SELECT json_build_object('amount', p.amount, 'currency', p.currency) FROM postings p WHERE p.entry_id = fc.entry_id AND p.amount > 0 LIMIT 1) AS money
         FROM fraud_cases fc JOIN users u ON u.id = fc.user_id
        WHERE ($1::text IS NULL OR fc.status = $1)
        ORDER BY fc.created_at DESC LIMIT 200`,
      [status || null],
    );
    return rows.map((r) => ({
      id: r.id,
      user: { id: r.user_id, email: r.email, fullName: r.full_name },
      entryId: r.entry_id,
      score: Number(r.score),
      decision: r.decision,
      reasons: r.reasons,
      status: r.status,
      amount: r.money ? fromMinor(r.money.amount, r.money.currency) : r.context?.amountMinor != null ? fromMinor(r.context.amountMinor, r.context.currency) : null,
      currency: r.money?.currency ?? r.context?.currency ?? null,
      features: r.context?.features ?? null,
      createdAt: r.created_at,
      reviewedAt: r.reviewed_at,
    }));
  }

  @HttpCode(200)
  @Post('fraud-cases/:id/:action')
  async resolve(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('action') action: string,
    @Ip() ip: string,
  ) {
    if (action !== 'approve' && action !== 'reject') throw new BadRequestException('Action must be approve or reject');
    const fc = await this.db.one(`SELECT * FROM fraud_cases WHERE id = $1 AND status = 'open'`, [id]);
    if (!fc) throw new NotFoundException('Open case not found');
    if (fc.entry_id) {
      if (action === 'approve') await this.transfers.releaseHeld(fc.entry_id, admin.id);
      else await this.transfers.reverseHeld(fc.entry_id, admin.id);
    }
    await this.db.query(`UPDATE fraud_cases SET status = $2, reviewed_by = $3, reviewed_at = now() WHERE id = $1`, [
      id,
      action === 'approve' ? 'approved' : 'rejected',
      admin.id,
    ]);
    await this.audit.log(`admin.fraud_${action}`, { actorId: admin.id, target: id, ip });
    return { id, status: action === 'approve' ? 'approved' : 'rejected' };
  }

  @Get('audit-logs')
  auditLogs() {
    return this.db.query(
      `SELECT a.id, a.action, a.target, a.ip, a.metadata, a.created_at AS "createdAt", u.email AS actor
         FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.id DESC LIMIT 200`,
    );
  }
}
