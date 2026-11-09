import { Body, Controller, Get, Headers, Ip, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Length, Matches, MaxLength } from 'class-validator';
import { AuthUser, CurrentUser } from '../../common/auth';
import { SUPPORTED_CURRENCIES, toMinor } from '../../common/money';
import { TransfersService } from './transfers.service';

export class SendMoneyDto {
  @ApiProperty() @IsUUID() recipientId: string;
  @ApiProperty({ example: '25.00' }) @Matches(/^\d+(\.\d{1,2})?$/) amount: string;
  @ApiProperty({ enum: SUPPORTED_CURRENCIES }) @IsIn(SUPPORTED_CURRENCIES) currency: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(140) note?: string;
  @ApiProperty({ description: 'Unique per payment attempt; retries with the same key never double-charge' })
  @IsString()
  @Length(8, 80)
  idempotencyKey: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{6}$/) mfaCode?: string;
}

@ApiTags('transfers')
@ApiBearerAuth()
@Controller('transfers')
export class TransfersController {
  constructor(private readonly transfers: TransfersService) {}

  @Get('lookup')
  lookup(@CurrentUser() user: AuthUser, @Query('q') q: string) {
    return this.transfers.lookupRecipient(q ?? '', user.id);
  }

  @Post()
  send(@CurrentUser() user: AuthUser, @Body() dto: SendMoneyDto, @Ip() ip: string, @Headers('x-device-id') deviceId?: string) {
    return this.transfers.send({
      senderId: user.id,
      recipientId: dto.recipientId,
      amountMinor: toMinor(dto.amount, dto.currency),
      currency: dto.currency,
      note: dto.note,
      idempotencyKey: dto.idempotencyKey,
      mfaCode: dto.mfaCode,
      deviceId: deviceId ?? user.deviceId,
      ip,
    });
  }
}
