import { HttpException, HttpStatus } from '@nestjs/common';

/** Error with a stable machine-readable code that clients can branch on. */
export class AppError extends HttpException {
  constructor(status: HttpStatus, code: string, message: string, extra: Record<string, unknown> = {}) {
    super({ statusCode: status, code, message, ...extra }, status);
  }
}

export const MfaRequired = (reason: string) =>
  new AppError(HttpStatus.FORBIDDEN, 'MFA_REQUIRED', 'Enter the 6-digit code from your authenticator app to continue.', {
    reason,
  });
