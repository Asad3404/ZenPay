import { Body, Controller, Get, Headers, HttpCode, Ip, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import { AuthUser, CurrentUser } from '../../common/auth';
import { SUPPORTED_CURRENCIES, toMinor } from '../../common/money';
import { PaymentsService } from './payments.service';

class CreateRequestDto {
  @ApiProperty({ example: '12.50' }) @Matches(/^\d+(\.\d{1,2})?$/) amount: string;
  @ApiProperty({ enum: SUPPORTED_CURRENCIES }) @IsIn(SUPPORTED_CURRENCIES) currency: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(25) reference?: string;
}

class ParseDto {
  @ApiProperty() @IsString() @MaxLength(512) payload: string;
}

class PayDto extends ParseDto {
  @ApiPropertyOptional({ description: 'Required for static QR codes' }) @IsOptional() @Matches(/^\d+(\.\d{1,2})?$/) amount?: string;
  @ApiProperty() @IsString() @Length(8, 80) idempotencyKey: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{6}$/) mfaCode?: string;
}

@ApiTags('payments')
@ApiBearerAuth()
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('requests')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateRequestDto) {
    return this.payments.createRequest(user.id, toMinor(dto.amount, dto.currency), dto.currency, dto.reference);
  }

  @Get('requests')
  list(@CurrentUser() user: AuthUser) {
    return this.payments.listRequests(user.id);
  }

  @HttpCode(200)
  @Post('requests/:id/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.payments.cancelRequest(user.id, id);
  }

  @Get('my-qr')
  myQr(@CurrentUser() user: AuthUser) {
    return this.payments.myQr(user.id);
  }

  @HttpCode(200)
  @Post('qr/parse')
  parse(@CurrentUser() user: AuthUser, @Body() dto: ParseDto) {
    return this.payments.parse(dto.payload, user.id);
  }

  @Post('qr/pay')
  pay(@CurrentUser() user: AuthUser, @Body() dto: PayDto, @Ip() ip: string, @Headers('x-device-id') deviceId?: string) {
    return this.payments.pay(user.id, dto, deviceId ?? user.deviceId, ip);
  }
}
