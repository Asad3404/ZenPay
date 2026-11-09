import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { config } from '../config';
import { DbService } from './db.service';

export interface AuthUser {
  id: string;
  email: string;
  role: 'user' | 'admin';
  deviceId?: string;
}

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);
export const ROLES = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES, roles);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});

/** Global guard: every route needs a valid access token unless marked @Public(). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly db: DbService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Missing bearer token');
    let payload: any;
    try {
      payload = await this.jwt.verifyAsync(header.slice(7), { secret: config.jwtSecret });
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    if (payload.typ !== 'access') throw new UnauthorizedException('Wrong token type');
    const user = await this.db.one<{ id: string; email: string; role: 'user' | 'admin'; status: string }>(
      'SELECT id, email, role, status FROM users WHERE id = $1',
      [payload.sub],
    );
    if (!user) throw new UnauthorizedException('User not found');
    if (user.status === 'frozen') throw new ForbiddenException('Account is frozen. Contact support.');
    req.user = { id: user.id, email: user.email, role: user.role, deviceId: payload.did } satisfies AuthUser;

    const roles = this.reflector.getAllAndOverride<string[]>(ROLES, [ctx.getHandler(), ctx.getClass()]);
    if (roles?.length && !roles.includes(user.role)) throw new ForbiddenException('Insufficient role');
    return true;
  }
}
