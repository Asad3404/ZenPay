import { Injectable, Logger } from '@nestjs/common';
import { DbService, Queryable } from './db.service';

@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');
  constructor(private readonly db: DbService) {}

  async log(
    action: string,
    opts: { actorId?: string | null; target?: string; ip?: string; metadata?: Record<string, unknown> } = {},
    client?: Queryable,
  ) {
    const q = client ?? this.db.pool;
    try {
      await q.query('INSERT INTO audit_logs (actor_id, action, target, ip, metadata) VALUES ($1, $2, $3, $4, $5)', [
        opts.actorId ?? null,
        action,
        opts.target ?? null,
        opts.ip ?? null,
        JSON.stringify(opts.metadata ?? {}),
      ]);
    } catch (err) {
      if (client) throw err;
      this.logger.error(`Failed to write audit log ${action}: ${(err as Error).message}`);
    }
  }
}
