import { Body, Controller, Get, Headers, Ip, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { AuthUser, CurrentUser } from '../../common/auth';
import { SUPPORTED_CURRENCIES, toMinor } from '../../common/money';
import { LedgerService } from '../ledger/ledger.service';
import { WalletsService } from './wallets.service';

class AmountDto {
  @ApiProperty({ example: '100.00' }) @Matches(/^\d+(\.\d{1,2})?$/) amount: string;
  @ApiProperty({ enum: SUPPORTED_CURRENCIES }) @IsIn(SUPPORTED_CURRENCIES) currency: string;
  @ApiProperty() @IsString() @Length(8, 80) idempotencyKey: string;
}

class WithdrawDto extends AmountDto {
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{6}$/) mfaCode?: string;
}

class ConvertDto {
  @ApiProperty({ example: '50.00' }) @Matches(/^\d+(\.\d{1,2})?$/) amount: string;
  @ApiProperty({ enum: SUPPORTED_CURRENCIES }) @IsIn(SUPPORTED_CURRENCIES) from: string;
  @ApiProperty({ enum: SUPPORTED_CURRENCIES }) @IsIn(SUPPORTED_CURRENCIES) to: string;
  @ApiProperty() @IsString() @Length(8, 80) idempotencyKey: string;
}

class OpenWalletDto {
  @ApiProperty({ enum: SUPPORTED_CURRENCIES }) @IsIn(SUPPORTED_CURRENCIES) currency: string;
}

@ApiTags('wallets')
@ApiBearerAuth()
@Controller('wallets')
export class WalletsController {
  constructor(private readonly wallets: WalletsService, private readonly ledger: LedgerService) {}

  @Get()
  overview(@CurrentUser() user: AuthUser) {
    return this.wallets.overview(user.id);
  }

  @Post()
  open(@CurrentUser() user: AuthUser, @Body() dto: OpenWalletDto) {
    return this.wallets.openWallet(user.id, dto.currency);
  }

  @Get('transactions')
  transactions(
    @CurrentUser() user: AuthUser,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
    @Query('currency') currency?: string,
  ) {
    return this.ledger.history(user.id, { limit: limit ? Number(limit) : undefined, before, currency });
  }

  @Post('deposit')
  deposit(@CurrentUser() user: AuthUser, @Body() dto: AmountDto, @Ip() ip: string) {
    return this.wallets.deposit(user.id, toMinor(dto.amount, dto.currency), dto.currency, dto.idempotencyKey, ip);
  }

  @Post('withdraw')
  withdraw(@CurrentUser() user: AuthUser, @Body() dto: WithdrawDto, @Ip() ip: string, @Headers('x-device-id') deviceId?: string) {
    return this.wallets.withdraw(user.id, toMinor(dto.amount, dto.currency), dto.currency, dto.idempotencyKey, dto.mfaCode, deviceId ?? user.deviceId, ip);
  }

  @Post('convert')
  convert(@CurrentUser() user: AuthUser, @Body() dto: ConvertDto, @Ip() ip: string) {
    return this.wallets.convert(user.id, toMinor(dto.amount, dto.from), dto.from, dto.to, dto.idempotencyKey, ip);
  }
}
