import { Injectable, Logger } from '@nestjs/common';
import { config } from '../../config';
import { DbService, Queryable } from '../../common/db.service';

export type FraudDecision = 'allow' | 'challenge' | 'review' | 'block';

export interface FraudInput {
  userId: string;
  kind: 'transfer' | 'qr_payment' | 'withdrawal' | 'fx';
  amountUsdMinor: number;
  recipientId?: string;
  deviceId?: string;
}

export interface FraudFeatures {
  amount_usd: number;
  account_age_days: number;
  tx_count_1h: number;
  tx_count_24h: number;
  amount_sum_24h_usd: number;
  avg_amount_90d_usd: number;
  is_new_recipient: number;
  is_known_device: number;
  kyc_level: number;
  hour_of_day: number;
}

export interface FraudAssessment {
  score: number;
  ruleScore: number;
  modelScore: number | null;
  decision: FraudDecision;
  reasons: string[];
  features: FraudFeatures;
}

/** Thresholds on the combined 0..1 risk score. */
export const THRESHOLDS = { challenge: 0.5, review: 0.75, block: 0.92 };
/** Minimum rule score before the ML model is allowed to push a payment into a hard block. */
export const MODEL_BLOCK_MIN_RULE_SCORE = 0.3;

/**
 * Two-layer fraud engine:
 *  1. Deterministic rules (explainable, always available).
 *  2. ML risk score from the AI service (gradient boosting + isolation forest), when reachable.
 * The final score is the higher of the two, so the model can raise risk but never hide a rule hit.
 */
@Injectable()
export class FraudService {
  private readonly logger = new Logger('Fraud');
  constructor(private readonly db: DbService) {}

  async features(input: FraudInput, client: Queryable = this.db.pool): Promise<FraudFeatures> {
    const { rows } = await client.query(
      `WITH outgoing AS (
         SELECT je.created_at, (je.metadata->>'amountUsdMinor')::bigint AS usd, je.metadata->>'recipientId' AS recipient
           FROM journal_entries je
          WHERE je.initiated_by = $1 AND je.kind IN ('transfer', 'qr_payment', 'withdrawal')
            AND je.created_at > now() - interval '90 days')
       SELECT
         EXTRACT(EPOCH FROM now() - u.created_at) / 86400 AS age_days,
         u.kyc_level,
         (SELECT count(*) FROM outgoing WHERE created_at > now() - interval '1 hour') AS c1h,
         (SELECT count(*) FROM outgoing WHERE created_at > now() - interval '24 hours') AS c24h,
         (SELECT COALESCE(sum(usd), 0) FROM outgoing WHERE created_at > now() - interval '24 hours') AS s24h,
         (SELECT COALESCE(avg(usd), 0) FROM outgoing) AS avg90,
         (SELECT count(*) FROM outgoing WHERE recipient = $2) AS prior_to_recipient,
         (SELECT count(*) FROM refresh_tokens WHERE user_id = $1 AND device_id = $3 AND created_at < now() - interval '1 hour') AS device_seen
       FROM users u WHERE u.id = $1`,
      [input.userId, input.recipientId ?? '', input.deviceId ?? ''],
    );
    const r = rows[0];
    return {
      amount_usd: input.amountUsdMinor / 100,
      account_age_days: Number(r.age_days),
      tx_count_1h: Number(r.c1h),
      tx_count_24h: Number(r.c24h),
      amount_sum_24h_usd: Number(r.s24h) / 100,
      avg_amount_90d_usd: Number(r.avg90) / 100,
      is_new_recipient: input.recipientId ? (Number(r.prior_to_recipient) === 0 ? 1 : 0) : 0,
      is_known_device: input.deviceId ? (Number(r.device_seen) > 0 ? 1 : 0) : 0,
      kyc_level: Number(r.kyc_level),
      hour_of_day: new Date().getUTCHours(),
    };
  }

  rules(f: FraudFeatures): { score: number; reasons: string[] } {
    const hits: [number, string][] = [];
    if (f.avg_amount_90d_usd > 0 && f.amount_usd > 10 * f.avg_amount_90d_usd && f.amount_usd >= 200) {
      hits.push([0.35, 'Amount is far above this account’s usual spending']);
    }
    if (f.tx_count_1h >= 5) hits.push([0.3, 'Many payments in the last hour']);
    if (f.tx_count_1h >= 10) hits.push([0.4, 'Payment velocity is extremely high']);
    if (f.account_age_days < 1 && f.amount_usd >= 500) hits.push([0.35, 'Large payment from a brand-new account']);
    if (f.is_new_recipient && f.amount_usd >= 1000) hits.push([0.25, 'Large payment to a first-time recipient']);
    if (!f.is_known_device && f.amount_usd >= 250) hits.push([0.15, 'Payment from an unrecognised device']);
    if (f.hour_of_day >= 1 && f.hour_of_day <= 4 && f.amount_usd >= 500) hits.push([0.1, 'Large payment at an unusual hour']);
    if (f.amount_usd >= 10_000) hits.push([0.3, 'Very large single payment']);
    const score = Math.min(1, hits.reduce((s, [w]) => s + w, 0));
    return { score, reasons: hits.map(([, r]) => r) };
  }

  async modelScore(f: FraudFeatures): Promise<{ score: number; reasons: string[] } | null> {
    if (!config.aiServiceUrl) return null;
    try {
      const res = await fetch(`${config.aiServiceUrl}/v1/fraud/score`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(f),
        signal: AbortSignal.timeout(1500),
      });
      if (!res.ok) throw new Error(`AI service ${res.status}`);
      const body: any = await res.json();
      return { score: Number(body.score), reasons: body.reasons ?? [] };
    } catch (err) {
      this.logger.warn(`Fraud model unavailable, using rules only: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * The model can raise risk up to a manual review on its own, but a hard block also needs
   * explainable rule evidence, so an over-confident model can't lock customers out.
   */
  combine(ruleScore: number, modelScore: number | null): number {
    if (modelScore === null) return ruleScore;
    const cappedModel = ruleScore >= MODEL_BLOCK_MIN_RULE_SCORE ? modelScore : Math.min(modelScore, THRESHOLDS.block - 0.01);
    return Math.max(ruleScore, cappedModel);
  }

  decide(score: number): FraudDecision {
    if (score >= THRESHOLDS.block) return 'block';
    if (score >= THRESHOLDS.review) return 'review';
    if (score >= THRESHOLDS.challenge) return 'challenge';
    return 'allow';
  }

  async assess(input: FraudInput, client?: Queryable): Promise<FraudAssessment> {
    const features = await this.features(input, client);
    const rule = this.rules(features);
    const model = await this.modelScore(features);
    const score = this.combine(rule.score, model?.score ?? null);
    // Prefer the rules' explanations; fall back to the model's when only the model raised the score.
    const reasons = rule.reasons.length ? rule.reasons : model && model.score >= THRESHOLDS.challenge ? model.reasons : [];
    return {
      score: Math.round(score * 10_000) / 10_000,
      ruleScore: rule.score,
      modelScore: model?.score ?? null,
      decision: this.decide(score),
      reasons: [...new Set(reasons)],
      features,
    };
  }

  async recordCase(
    client: Queryable,
    userId: string,
    a: FraudAssessment,
    status: 'open' | 'rejected' | 'logged',
    entryId: string | null,
    context: Record<string, unknown>,
  ) {
    const { rows } = await client.query(
      `INSERT INTO fraud_cases (user_id, entry_id, score, decision, reasons, status, context)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [userId, entryId, a.score, a.decision, JSON.stringify(a.reasons), status, JSON.stringify({ ...context, features: a.features })],
    );
    return rows[0].id as string;
  }
}
