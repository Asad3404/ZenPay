import { Body, Controller, Get, HttpCode, Ip, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { AuditService } from '../../common/audit.service';
import { AuthUser, CurrentUser } from '../../common/auth';
import { DbService } from '../../common/db.service';
import { SUPPORTED_CURRENCIES } from '../../common/money';
import { NotificationsService } from '../../common/notifications.service';
import { KycService } from './kyc.service';

class UpdateProfileDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 100) fullName?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\+?[1-9]\d{7,14}$/) phone?: string;
  @ApiPropertyOptional({ enum: SUPPORTED_CURRENCIES }) @IsOptional() @IsIn(SUPPORTED_CURRENCIES) baseCurrency?: string;
}

export class KycDto {
  @ApiProperty() @IsString() @Length(2, 100) fullName: string;
  @ApiProperty({ example: '1990-04-21' }) @IsDateString() dateOfBirth: string;
  @ApiProperty({ example: 'PK' }) @Matches(/^[A-Z]{2}$/) country: string;
  @ApiProperty({ enum: ['passport', 'national_id', 'driving_license'] }) @IsIn(['passport', 'national_id', 'driving_license']) idType: string;
  @ApiProperty() @IsString() @Length(5, 30) idNumber: string;
}

@ApiTags('users')
@ApiBearerAuth()
@Controller()
export class UsersController {
  constructor(
    private readonly db: DbService,
    private readonly kyc: KycService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    const u = await this.db.one(
      `SELECT id, email, phone, full_name AS "fullName", role, status, kyc_level AS "kycLevel",
              base_currency AS "baseCurrency", mfa_enabled AS "mfaEnabled", created_at AS "createdAt"
         FROM users WHERE id = $1`,
      [user.id],
    );
    return u;
  }

  @Patch('me')
  async update(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto, @Ip() ip: string) {
    await this.db.query(
      `UPDATE users SET full_name = COALESCE($2, full_name), phone = COALESCE($3, phone),
              base_currency = COALESCE($4, base_currency), updated_at = now() WHERE id = $1`,
      [user.id, dto.fullName ?? null, dto.phone ?? null, dto.baseCurrency ?? null],
    );
    await this.audit.log('user.profile_updated', { actorId: user.id, ip, metadata: { fields: Object.keys(dto) } });
    return this.me(user);
  }

  @Post('kyc')
  submitKyc(@CurrentUser() user: AuthUser, @Body() dto: KycDto, @Ip() ip: string) {
    return this.kyc.submit(user.id, dto, ip);
  }

  @Get('kyc')
  kycStatus(@CurrentUser() user: AuthUser) {
    return this.kyc.status(user.id);
  }

  @Get('notifications')
  list(@CurrentUser() user: AuthUser) {
    return this.notifications.list(user.id);
  }

  @HttpCode(200)
  @Post('notifications/:id/read')
  read(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.notifications.markRead(user.id, id);
  }
}
