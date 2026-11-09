import { Injectable } from '@nestjs/common';
import { DbService, Queryable } from './db.service';

@Injectable()
export class NotificationsService {
  constructor(private readonly db: DbService) {}

  async notify(userId: string, title: string, body: string, client?: Queryable) {
    await (client ?? this.db.pool).query('INSERT INTO notifications (user_id, title, body) VALUES ($1, $2, $3)', [
      userId,
      title,
      body,
    ]);
  }

  list(userId: string) {
    return this.db.query(
      'SELECT id, title, body, read_at AS "readAt", created_at AS "createdAt" FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
      [userId],
    );
  }

  async markRead(userId: string, id: string) {
    await this.db.query('UPDATE notifications SET read_at = now() WHERE id = $1 AND user_id = $2 AND read_at IS NULL', [
      id,
      userId,
    ]);
    return { ok: true };
  }
}
