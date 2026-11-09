import { Body, Controller, HttpCode, Ip, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsString, MaxLength } from 'class-validator';
import { AuthUser, CurrentUser, Public } from '../../common/auth';
import { CodeDto, LoginDto, MfaVerifyDto, QrApproveDto, RefreshDto, RegisterDto } from './auth.dto';
import { AuthService } from './auth.service';

class PollDto {
  @IsString() @MaxLength(128) pollSecret: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  register(@Body() dto: RegisterDto, @Ip() ip: string) {
    return this.auth.register(dto, ip);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login')
  login(@Body() dto: LoginDto, @Ip() ip: string) {
    return this.auth.login(dto, ip);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('mfa/verify')
  verifyMfa(@Body() dto: MfaVerifyDto, @Ip() ip: string) {
    return this.auth.verifyMfaLogin(dto.mfaToken, dto.code, ip);
  }

  @Public()
  @HttpCode(200)
  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Public()
  @HttpCode(200)
  @Post('logout')
  logout(@Body() dto: RefreshDto) {
    return this.auth.logout(dto.refreshToken);
  }

  @ApiBearerAuth()
  @Post('mfa/setup')
  mfaSetup(@CurrentUser() user: AuthUser) {
    return this.auth.startMfaSetup(user.id);
  }

  @ApiBearerAuth()
  @HttpCode(200)
  @Post('mfa/enable')
  mfaEnable(@CurrentUser() user: AuthUser, @Body() dto: CodeDto, @Ip() ip: string) {
    return this.auth.enableMfa(user.id, dto.code, ip);
  }

  @ApiBearerAuth()
  @HttpCode(200)
  @Post('mfa/disable')
  mfaDisable(@CurrentUser() user: AuthUser, @Body() dto: CodeDto, @Ip() ip: string) {
    return this.auth.disableMfa(user.id, dto.code, ip);
  }

  /** Web: create a QR login session and display qrPayload as a QR code. */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('qr/session')
  createQr() {
    return this.auth.createQrSession();
  }

  /** Web: poll with the secret returned at creation. Returns tokens once approved. */
  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @HttpCode(200)
  @Post('qr/session/:id/poll')
  pollQr(@Param('id') id: string, @Body() dto: PollDto) {
    return this.auth.pollQrSession(id, dto.pollSecret);
  }

  /** Mobile (already logged in): approve the scanned QR session. */
  @ApiBearerAuth()
  @HttpCode(200)
  @Post('qr/approve')
  approveQr(@CurrentUser() user: AuthUser, @Body() dto: QrApproveDto, @Ip() ip: string) {
    return this.auth.approveQrSession(user.id, dto.sessionId, ip);
  }
}
