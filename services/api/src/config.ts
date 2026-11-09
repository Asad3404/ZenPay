import 'dotenv/config';

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

const isProd = process.env.NODE_ENV === 'production';

/** Development fallbacks are only allowed outside production. */
function secret(name: string, devFallback: string): string {
  return isProd ? required(name) : required(name, devFallback);
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  isProd,
  databaseUrl: required('DATABASE_URL', 'postgres://postgres@localhost:5432/securepay'),
  redisUrl: required('REDIS_URL', 'redis://localhost:6379'),
  jwtSecret: secret('JWT_SECRET', 'dev-access-secret-change-me'),
  jwtRefreshSecret: secret('JWT_REFRESH_SECRET', 'dev-refresh-secret-change-me'),
  accessTokenTtlSeconds: 15 * 60,
  refreshTokenTtlDays: 30,
  dataEncryptionKey: secret('DATA_ENCRYPTION_KEY', '0'.repeat(64)),
  aiServiceUrl: process.env.AI_SERVICE_URL ?? '',
  fxRatesUrl: process.env.FX_RATES_URL ?? '',
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000').split(',').map((s) => s.trim()),
  /** Daily send limit per KYC level, in USD minor units. */
  kycDailyLimitsUsd: { 0: 100_00, 1: 5_000_00, 2: 50_000_00 } as Record<number, number>,
  /** Transfers at or above this USD amount always require an MFA code. */
  stepUpThresholdUsd: 1_000_00,
  fxSpreadBps: 50,
  qrPaymentTtlMinutes: 15,
  qrLoginTtlSeconds: 120,
  maxFailedLogins: 5,
};
