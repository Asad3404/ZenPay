import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';
import { SUPPORTED_CURRENCIES } from '../../common/money';

export class RegisterDto {
  @ApiProperty() @IsEmail() @MaxLength(254) email: string;
  @ApiProperty({ description: 'At least 8 characters with a letter and a number' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, { message: 'Password must contain a letter and a number' })
  password: string;
  @ApiProperty() @IsString() @Length(2, 100) fullName: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\+?[1-9]\d{7,14}$/, { message: 'Phone must be in international format' }) phone?: string;
  @ApiPropertyOptional({ enum: SUPPORTED_CURRENCIES }) @IsOptional() @IsIn(SUPPORTED_CURRENCIES) baseCurrency?: string;
}

export class LoginDto {
  @ApiProperty() @IsEmail() email: string;
  @ApiProperty() @IsString() @MaxLength(128) password: string;
  @ApiPropertyOptional({ description: 'Stable per-install device identifier, used by fraud checks' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  deviceId?: string;
}

export class MfaVerifyDto {
  @ApiProperty() @IsString() mfaToken: string;
  @ApiProperty() @Matches(/^\d{6}$/) code: string;
}

export class CodeDto {
  @ApiProperty() @Matches(/^\d{6}$/) code: string;
}

export class RefreshDto {
  @ApiProperty() @IsString() @MaxLength(512) refreshToken: string;
}

export class QrApproveDto {
  @ApiProperty() @IsString() @MaxLength(64) sessionId: string;
}
