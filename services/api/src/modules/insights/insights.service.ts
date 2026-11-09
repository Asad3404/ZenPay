import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { config } from '../../config';
import { DbService } from '../../common/db.service';
import { assertCurrency, fromMinor } from '../../common/money';
import { FxService } from '../fx/fx.service';
import { LedgerService } from '../ledger/ledger.service';

@Injectable()
export class InsightsService {
  private readonly logger = new Logger('Insights');
  constructor(
    private readonly db: DbService,
    private readonly ledger: LedgerService,
    private readonly fx: FxService,
  ) {}

  /** Builds the privacy-minimised data sent to the AI service: no ids, emails or account numbers. */
  private async context(userId: string) {
    const user = await this.db.one('SELECT full_name, base_currency FROM users WHERE id = $1', [userId]);
    const base = user.base_currency;
    const since = new Date(Date.now() - 180 * 24 * 3600 * 1000);
    const history = await this.ledger.history(userId, { limit: 500, since });
    const transactions = [];
    for (const t of history) {
      if (t.status === 'rejected') continue;
      transactions.push({
        date: new Date(t.createdAt).toISOString(),
        kind: t.kind,
        direction: t.direction,
        amount: Number(fromMinor(await this.fx.convertMinor(Math.abs(t.amountMinor), t.currency, base), base)),
        description: t.note || t.description || '',
        counterparty: t.counterparty ?? '',
      });
    }
    const budgets = (await this.listBudgets(userId)).map((b) => ({ category: b.category, monthly_limit: Number(b.monthlyLimit), currency: b.currency }));
    const overview = await this.ledger.balances(userId);
    let balance = 0;
    for (const b of overview) balance += await this.fx.convertMinor(b.balanceMinor, b.currency, base);
    return {
      first_name: (user.full_name as string).split(' ')[0],
      currency: base,
      balance: Number(fromMinor(balance, base)),
      transactions,
      budgets,
    };
  }

  private async callAi(path: string, body: unknown, timeoutMs: number) {
    if (!config.aiServiceUrl) throw new ServiceUnavailableException('AI service is not configured');
    const res = await fetch(`${config.aiServiceUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    }).catch((err) => {
      this.logger.warn(`AI service error: ${err.message}`);
      throw new ServiceUnavailableException('AI service is unavailable. Try again shortly.');
    });
    if (!res.ok) throw new ServiceUnavailableException(`AI service returned ${res.status}`);
    return res.json();
  }

  async insights(userId: string) {
    return this.callAi('/v1/insights/analyze', await this.context(userId), 10_000);
  }

  async chat(userId: string, message: string, history: { role: 'user' | 'assistant'; content: string }[]) {
    const context = await this.context(userId);
    return this.callAi('/v1/assistant/chat', { message, history: history.slice(-10), context }, 120_000);
  }

  async listBudgets(userId: string) {
    const rows = await this.db.query('SELECT * FROM budgets WHERE user_id = $1 ORDER BY category', [userId]);
    return rows.map((r) => ({ id: r.id, category: r.category, monthlyLimit: fromMinor(r.monthly_limit, r.currency), currency: r.currency }));
  }

  async upsertBudget(userId: string, category: string, monthlyLimitMinor: number, currency: string) {
    await this.db.query(
      `INSERT INTO budgets (user_id, category, monthly_limit, currency) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, category, currency) DO UPDATE SET monthly_limit = EXCLUDED.monthly_limit`,
      [userId, category, monthlyLimitMinor, assertCurrency(currency)],
    );
    return this.listBudgets(userId);
  }

  async deleteBudget(userId: string, id: string) {
    await this.db.query('DELETE FROM budgets WHERE id = $1 AND user_id = $2', [id, userId]);
    return this.listBudgets(userId);
  }
}
