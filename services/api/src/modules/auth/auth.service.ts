import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import * as QRCode from 'qrcode';
import { AuditService } from '../../common/audit.service';
import { config } from '../../config';
import { decrypt, encrypt, randomToken, sha256 } from '../../common/crypto';
import { DbService } from '../../common/db.service';
import { RedisService } from '../../common/redis.service';
import { generateSecret, otpauthUrl, verifyTotp } from '../../common/totp';
import { LedgerService } from '../ledger/ledger.service';
import { LoginDto, RegisterDto } from './auth.dto';

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: { id: string; email: string; fullName: string; role: string; mfaEnabled: boolean };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DbService,
    private readonly redis: RedisService,
    private readonly jwt: JwtService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  async register(dto: RegisterDto, ip?: string): Promise<Tokens> {
    const email = dto.email.trim().toLowerCase();
    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
    const user = await this.db
      .tx(async (client) => {
        const { rows } = await client.query(
          `INSERT INTO users (email, phone, full_name, password_hash, base_currency)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [email, dto.phone ?? null, dto.fullName.trim(), passwordHash, dto.baseCurrency ?? 'USD'],
        );
        await this.ledger.getOrCreateWallet(rows[0].id, rows[0].base_currency, client);
        await this.audit.log('user.registered', { actorId: rows[0].id, ip }, client);
        return rows[0];
      })
      .catch((err) => {
        if (err.code === '23505') throw new ConflictException('An account with this email or phone already exists');
        throw err;
      });
    return this.issueTokens(user);
  }

  async login(dto: LoginDto, ip?: string): Promise<Tokens | { mfaRequired: true; mfaToken: string }> {
    const email = dto.email.trim().toLowerCase();
    const user = await this.db.one('SELECT * FROM users WHERE email = $1', [email]);
    // Same error for unknown email and wrong password, to avoid account enumeration.
    const invalid = new UnauthorizedException('Invalid email or password');
    if (!user) {
      await argon2.hash('timing-equaliser');
      throw invalid;
    }
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      throw new ForbiddenException('Too many failed attempts. Try again later.');
    }
    if (!(await argon2.verify(user.password_hash, dto.password))) {
      const failed = user.failed_logins + 1;
      const lock = failed >= config.maxFailedLogins;
      await this.db.query(
        `UPDATE users SET failed_logins = $2, locked_until = CASE WHEN $3 THEN now() + interval '15 minutes' ELSE locked_until END WHERE id = $1`,
        [user.id, lock ? 0 : failed, lock],
      );
      await this.audit.log('auth.login_failed', { actorId: user.id, ip, metadata: { locked: lock } });
      throw invalid;
    }
    if (user.status === 'frozen') throw new ForbiddenException('Account is frozen. Contact support.');
    await this.db.query('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1', [user.id]);

    if (user.mfa_enabled) {
      const mfaToken = await this.jwt.signAsync(
        { sub: user.id, typ: 'mfa', did: dto.deviceId },
        { secret: config.jwtSecret, expiresIn: 300 },
      );
      return { mfaRequired: true, mfaToken };
    }
    await this.audit.log('auth.login', { actorId: user.id, ip, metadata: { deviceId: dto.deviceId } });
    return this.issueTokens(user, dto.deviceId);
  }

  async verifyMfaLogin(mfaToken: string, code: string, ip?: string): Promise<Tokens> {
    let payload: any;
    try {
      payload = await this.jwt.verifyAsync(mfaToken, { secret: config.jwtSecret });
    } catch {
      throw new UnauthorizedException('MFA session expired. Log in again.');
    }
    if (payload.typ !== 'mfa') throw new UnauthorizedException('Wrong token type');
    await this.assertMfaCode(payload.sub, code);
    const user = await this.db.one('SELECT * FROM users WHERE id = $1', [payload.sub]);
    await this.audit.log('auth.login', { actorId: user.id, ip, metadata: { mfa: true, deviceId: payload.did } });
    return this.issueTokens(user, payload.did);
  }

  async refresh(refreshToken: string): Promise<Tokens> {
    const hash = sha256(refreshToken);
    const row = await this.db.one(
      'SELECT * FROM refresh_tokens WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()',
      [hash],
    );
    if (!row) throw new UnauthorizedException('Invalid refresh token');
    // Rotation: each refresh token works once.
    await this.db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [row.id]);
    const user = await this.db.one('SELECT * FROM users WHERE id = $1', [row.user_id]);
    if (!user || user.status === 'frozen') throw new UnauthorizedException('Account unavailable');
    return this.issueTokens(user, row.device_id ?? undefined);
  }

  async logout(refreshToken: string) {
    await this.db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1', [sha256(refreshToken)]);
    return { ok: true };
  }

  // ---- MFA (TOTP) ----

  async startMfaSetup(userId: string) {
    const user = await this.db.one('SELECT email, mfa_enabled FROM users WHERE id = $1', [userId]);
    if (user.mfa_enabled) throw new BadRequestException('MFA is already enabled');
    const secret = generateSecret();
    await this.redis.setJson(`mfa:setup:${userId}`, { secret }, 600);
    const url = otpauthUrl(secret, user.email);
    return { secret, otpauthUrl: url, qrCodeDataUrl: await QRCode.toDataURL(url) };
  }

  async enableMfa(userId: string, code: string, ip?: string) {
    const pending = await this.redis.getJson<{ secret: string }>(`mfa:setup:${userId}`);
    if (!pending) throw new BadRequestException('Start MFA setup first');
    const step = verifyTotp(pending.secret, code);
    if (step === null) throw new BadRequestException('Invalid code');
    // Burn this code so it cannot be replayed for a login right after setup.
    await this.redis.client.set(`mfa:used:${userId}:${step}`, '1', 'EX', 120);
    await this.db.query('UPDATE users SET mfa_enabled = TRUE, mfa_secret_enc = $2, updated_at = now() WHERE id = $1', [
      userId,
      encrypt(pending.secret),
    ]);
    await this.redis.client.del(`mfa:setup:${userId}`);
    await this.audit.log('auth.mfa_enabled', { actorId: userId, ip });
    return { mfaEnabled: true };
  }

  async disableMfa(userId: string, code: string, ip?: string) {
    await this.assertMfaCode(userId, code);
    await this.db.query('UPDATE users SET mfa_enabled = FALSE, mfa_secret_enc = NULL, updated_at = now() WHERE id = $1', [userId]);
    await this.audit.log('auth.mfa_disabled', { actorId: userId, ip });
    return { mfaEnabled: false };
  }

  async hasMfa(userId: string): Promise<boolean> {
    const row = await this.db.one('SELECT mfa_enabled FROM users WHERE id = $1', [userId]);
    return !!row?.mfa_enabled;
  }

  /** Verifies a TOTP code and blocks reuse of the same time step (replay protection). */
  async assertMfaCode(userId: string, code: string | undefined) {
    const row = await this.db.one('SELECT mfa_enabled, mfa_secret_enc FROM users WHERE id = $1', [userId]);
    if (!row?.mfa_enabled || !row.mfa_secret_enc) throw new ForbiddenException('MFA is not enabled on this account');
    const attemptsKey = `mfa:attempts:${userId}`;
    const attempts = await this.redis.client.incr(attemptsKey);
    if (attempts === 1) await this.redis.client.expire(attemptsKey, 300);
    if (attempts > 10) throw new ForbiddenException('Too many MFA attempts. Wait a few minutes.');
    const step = code ? verifyTotp(decrypt(row.mfa_secret_enc), code) : null;
    if (step === null) throw new UnauthorizedException('Invalid MFA code');
    const fresh = await this.redis.client.set(`mfa:used:${userId}:${step}`, '1', 'EX', 120, 'NX');
    if (!fresh) throw new UnauthorizedException('MFA code already used. Wait for the next code.');
    await this.redis.client.del(attemptsKey);
  }

  // ---- QR login (scan from the logged-in phone to sign in on the web) ----

  async createQrSession() {
    const sessionId = randomToken(16);
    const pollSecret = randomToken(24);
    await this.redis.setJson(
      `qrlogin:${sessionId}`,
      { status: 'pending', pollSecretHash: sha256(pollSecret) },
      config.qrLoginTtlSeconds,
    );
    const qrPayload = `securepay://login?sid=${sessionId}`;
    return {
      sessionId,
      pollSecret,
      qrPayload,
      qrCodeDataUrl: await QRCode.toDataURL(qrPayload),
      expiresIn: config.qrLoginTtlSeconds,
    };
  }

  async approveQrSession(userId: string, sessionId: string, ip?: string) {
    const key = `qrlogin:${sessionId}`;
    const session = await this.redis.getJson<any>(key);
    if (!session || session.status !== 'pending') throw new NotFoundException('QR code expired or already used');
    const ttl = await this.redis.client.ttl(key);
    await this.redis.setJson(key, { ...session, status: 'approved', userId }, Math.max(ttl, 10));
    await this.audit.log('auth.qr_approved', { actorId: userId, ip, target: sessionId });
    return { approved: true };
  }

  async pollQrSession(sessionId: string, pollSecret: string) {
    const key = `qrlogin:${sessionId}`;
    const session = await this.redis.getJson<any>(key);
    if (!session) return { status: 'expired' };
    if (session.pollSecretHash !== sha256(pollSecret ?? '')) throw new ForbiddenException('Invalid poll secret');
    if (session.status !== 'approved') return { status: session.status };
    // One-time handoff: delete before issuing tokens.
    const deleted = await this.redis.client.del(key);
    if (!deleted) return { status: 'expired' };
    const user = await this.db.one('SELECT * FROM users WHERE id = $1', [session.userId]);
    return { status: 'approved', ...(await this.issueTokens(user, 'qr-web')) };
  }

  private async issueTokens(user: any, deviceId?: string): Promise<Tokens> {
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, role: user.role, typ: 'access', did: deviceId },
      { secret: config.jwtSecret, expiresIn: config.accessTokenTtlSeconds },
    );
    const refreshToken = randomToken(48);
    await this.db.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, device_id, expires_at)
       VALUES ($1, $2, $3, now() + ($4 || ' days')::interval)`,
      [user.id, sha256(refreshToken), deviceId ?? null, String(config.refreshTokenTtlDays)],
    );
    return {
      accessToken,
      refreshToken,
      expiresIn: config.accessTokenTtlSeconds,
      user: { id: user.id, email: user.email, fullName: user.full_name, role: user.role, mfaEnabled: user.mfa_enabled },
    };
  }
}
