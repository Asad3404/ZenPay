import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DbService, Queryable } from '../../common/db.service';
import { assertCurrency, fromMinor } from '../../common/money';

export type EntryKind = 'deposit' | 'withdrawal' | 'transfer' | 'fx' | 'qr_payment' | 'hold_release' | 'hold_reversal';
export type SystemAccountCode = 'funding' | 'fees' | 'fx' | 'holds';

export interface PostingInput {
  accountId: string;
  /** Positive increases the account balance, negative decreases it. Minor units. */
  amount: number;
  currency: string;
}

export interface EntryInput {
  kind: EntryKind;
  status?: 'completed' | 'held' | 'rejected';
  description?: string;
  initiatedBy?: string | null;
  idempotencyKey?: string | null;
  parentId?: string | null;
  metadata?: Record<string, unknown>;
  postings: PostingInput[];
}

export interface JournalEntry {
  id: string;
  kind: EntryKind;
  status: string;
  description: string | null;
  metadata: Record<string, any>;
  created_at: Date;
  replayed?: boolean;
}

/**
 * Double-entry ledger. All money movement in SecurePay goes through post().
 * Invariants enforced here and in the database:
 *  - postings of an entry sum to zero per currency
 *  - wallet balances never go negative (CHECK constraint)
 *  - postings are immutable (trigger)
 *  - (initiator, idempotency key) is unique, so retries never double-spend
 */
@Injectable()
export class LedgerService {
  constructor(private readonly db: DbService) {}

  async getOrCreateWallet(userId: string, currency: string, client: Queryable = this.db.pool) {
    const cur = assertCurrency(currency);
    await client.query(
      `INSERT INTO accounts (user_id, type, currency) VALUES ($1, 'wallet', $2)
       ON CONFLICT (user_id, currency) WHERE type = 'wallet' DO NOTHING`,
      [userId, cur],
    );
    const { rows } = await client.query(`SELECT * FROM accounts WHERE user_id = $1 AND currency = $2 AND type = 'wallet'`, [
      userId,
      cur,
    ]);
    return rows[0] as { id: string; balance: string; currency: string };
  }

  async systemAccount(code: SystemAccountCode, currency: string, client: Queryable = this.db.pool) {
    const cur = assertCurrency(currency);
    await client.query(
      `INSERT INTO accounts (type, code, currency) VALUES ('system', $1, $2)
       ON CONFLICT (code, currency) WHERE type = 'system' DO NOTHING`,
      [code, cur],
    );
    const { rows } = await client.query(`SELECT * FROM accounts WHERE code = $1 AND currency = $2 AND type = 'system'`, [
      code,
      cur,
    ]);
    return rows[0] as { id: string; balance: string; currency: string };
  }

  async findByIdempotencyKey(initiatedBy: string, key: string, client: Queryable = this.db.pool) {
    const { rows } = await client.query('SELECT * FROM journal_entries WHERE initiated_by = $1 AND idempotency_key = $2', [
      initiatedBy,
      key,
    ]);
    return (rows[0] as JournalEntry) ?? null;
  }

  /** Posts a balanced entry. Must be called inside a transaction (client from DbService.tx). */
  async post(client: PoolClient, input: EntryInput): Promise<JournalEntry> {
    if (input.postings.length < 2) throw new BadRequestException('An entry needs at least two postings');
    const sums = new Map<string, number>();
    for (const p of input.postings) {
      if (!Number.isSafeInteger(p.amount) || p.amount === 0) throw new BadRequestException('Invalid posting amount');
      sums.set(p.currency, (sums.get(p.currency) ?? 0) + p.amount);
    }
    for (const [cur, sum] of sums) {
      if (sum !== 0) throw new Error(`Unbalanced entry in ${cur}: ${sum}`);
    }

    if (input.initiatedBy && input.idempotencyKey) {
      const existing = await this.findByIdempotencyKey(input.initiatedBy, input.idempotencyKey, client);
      if (existing) return { ...existing, replayed: true };
    }

    // Lock in a stable order to avoid deadlocks between concurrent transfers.
    const ids = [...new Set(input.postings.map((p) => p.accountId))].sort();
    const { rows: locked } = await client.query(
      'SELECT id, currency, type FROM accounts WHERE id = ANY($1) ORDER BY id FOR UPDATE',
      [ids],
    );
    if (locked.length !== ids.length) throw new BadRequestException('Unknown account in entry');
    const byId = new Map(locked.map((a) => [a.id, a]));
    for (const p of input.postings) {
      if (byId.get(p.accountId).currency !== p.currency) throw new Error('Posting currency does not match account');
    }

    let entry: JournalEntry;
    try {
      await client.query('SAVEPOINT ledger_entry');
      const { rows } = await client.query(
        `INSERT INTO journal_entries (kind, status, description, initiated_by, idempotency_key, parent_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [
          input.kind,
          input.status ?? 'completed',
          input.description ?? null,
          input.initiatedBy ?? null,
          input.idempotencyKey ?? null,
          input.parentId ?? null,
          JSON.stringify(input.metadata ?? {}),
        ],
      );
      entry = rows[0];
      for (const p of input.postings) {
        await client.query('INSERT INTO postings (entry_id, account_id, amount, currency) VALUES ($1, $2, $3, $4)', [
          entry.id,
          p.accountId,
          p.amount,
          p.currency,
        ]);
        await client.query('UPDATE accounts SET balance = balance + $1 WHERE id = $2', [p.amount, p.accountId]);
      }
      await client.query('RELEASE SAVEPOINT ledger_entry');
    } catch (err: any) {
      await client.query('ROLLBACK TO SAVEPOINT ledger_entry');
      if (err.code === '23514' && err.constraint === 'wallet_non_negative') {
        throw new BadRequestException('Insufficient funds');
      }
      if (err.code === '23505' && input.initiatedBy && input.idempotencyKey) {
        const existing = await this.findByIdempotencyKey(input.initiatedBy, input.idempotencyKey, client);
        if (existing) return { ...existing, replayed: true };
        throw new ConflictException('Duplicate request');
      }
      throw err;
    }
    return entry;
  }

  async balances(userId: string) {
    const rows = await this.db.query(
      `SELECT id, currency, balance FROM accounts WHERE user_id = $1 AND type = 'wallet' ORDER BY currency`,
      [userId],
    );
    return rows.map((r) => ({
      accountId: r.id,
      currency: r.currency,
      balanceMinor: Number(r.balance),
      balance: fromMinor(r.balance, r.currency),
    }));
  }

  /** User-facing transaction history: one row per entry and currency touching the user's wallets. */
  async history(userId: string, opts: { limit?: number; before?: string; currency?: string; since?: Date } = {}) {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
    const params: unknown[] = [userId, limit];
    const filters: string[] = [];
    if (opts.before) {
      params.push(opts.before);
      filters.push(`je.created_at < $${params.length}`);
    }
    if (opts.since) {
      params.push(opts.since);
      filters.push(`je.created_at >= $${params.length}`);
    }
    if (opts.currency) {
      params.push(assertCurrency(opts.currency));
      filters.push(`p.currency = $${params.length}`);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const rows = await this.db.query(
      `SELECT je.id, je.kind, je.status, je.description, je.metadata, je.created_at,
              p.currency, SUM(p.amount)::bigint AS amount
         FROM postings p
         JOIN accounts a ON a.id = p.account_id AND a.type = 'wallet' AND a.user_id = $1
         JOIN journal_entries je ON je.id = p.entry_id
         ${where}
        GROUP BY je.id, p.currency
        ORDER BY je.created_at DESC
        LIMIT $2`,
      params,
    );
    return rows.map((r) => {
      const amount = Number(r.amount);
      const meta = r.metadata ?? {};
      const outgoing = amount < 0;
      return {
        id: r.id,
        kind: r.kind,
        status: r.status,
        description: r.description,
        direction: outgoing ? 'out' : 'in',
        amountMinor: amount,
        amount: fromMinor(amount, r.currency),
        currency: r.currency,
        counterparty: (outgoing ? meta.recipientName : meta.senderName) ?? meta.counterpartyName ?? null,
        note: meta.note ?? null,
        createdAt: r.created_at,
      };
    });
  }
}
