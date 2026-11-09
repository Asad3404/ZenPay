import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuditService } from './common/audit.service';
import { JwtAuthGuard } from './common/auth';
import { DbService } from './common/db.service';
import { NotificationsService } from './common/notifications.service';
import { RedisService } from './common/redis.service';
import { AdminController } from './modules/admin/admin.controller';
import { AuthController } from './modules/auth/auth.controller';
import { AuthService } from './modules/auth/auth.service';
import { FraudService } from './modules/fraud/fraud.service';
import { FxController } from './modules/fx/fx.controller';
import { FxService } from './modules/fx/fx.service';
import { HealthController } from './modules/health/health.controller';
import { InsightsController } from './modules/insights/insights.controller';
import { InsightsService } from './modules/insights/insights.service';
import { LedgerService } from './modules/ledger/ledger.service';
import { PaymentsController } from './modules/payments/payments.controller';
import { PaymentsService } from './modules/payments/payments.service';
import { TransfersController } from './modules/transfers/transfers.controller';
import { TransfersService } from './modules/transfers/transfers.service';
import { KycService } from './modules/users/kyc.service';
import { UsersController } from './modules/users/users.controller';
import { PaymentProvider, SandboxPaymentProvider } from './modules/wallets/payment-provider';
import { WalletsController } from './modules/wallets/wallets.controller';
import { WalletsService } from './modules/wallets/wallets.service';

@Module({
  imports: [
    JwtModule.register({}),
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: Number(process.env.RATE_LIMIT_PER_MINUTE ?? 300) }],
      // Only for automated tests; never set in production.
      skipIf: () => process.env.DISABLE_RATE_LIMIT === 'true' && process.env.NODE_ENV !== 'production',
    }),
  ],
  controllers: [
    HealthController,
    AuthController,
    UsersController,
    WalletsController,
    TransfersController,
    PaymentsController,
    FxController,
    InsightsController,
    AdminController,
  ],
  providers: [
    DbService,
    RedisService,
    AuditService,
    NotificationsService,
    LedgerService,
    FxService,
    FraudService,
    AuthService,
    KycService,
    TransfersService,
    WalletsService,
    PaymentsService,
    InsightsService,
    { provide: PaymentProvider, useClass: SandboxPaymentProvider },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
