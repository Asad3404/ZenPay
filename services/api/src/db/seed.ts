import 'reflect-metadata';
import * as argon2 from 'argon2';
import { Pool } from 'pg';
import { config } from '../config';
import { migrate } from './migrate';

/**
 * Creates demo users with balances and some history so the apps have data to show.
 * Admin:  admin@securepay.dev / Admin12345
 * Users:  alice@securepay.dev, bob@securepay.dev / Password123
 */
async function seed() {
  await migrate();
  const pool = new Pool({ connectionString: config.databaseUrl });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(`SELECT 1 FROM users WHERE email = 'admin@securepay.dev'`);
    if (existing.rowCount) {
      console.log('seed data already present');
      await client.query('ROLLBACK');
      return;
    }
    const pw = await argon2.hash('Password123', { type: argon2.argon2id });
    const adminPw = await argon2.hash('Admin12345', { type: argon2.argon2id });
    const ins = async (email: string, name: string, hash: string, role = 'user', kyc = 1, cur = 'USD') =>
      (
        await client.query(
          `INSERT INTO users (email, full_name, password_hash, role, kyc_level, base_currency, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, now() - interval '120 days') RETURNING id`,
          [email, name, hash, role, kyc, cur],
        )
      ).rows[0].id as string;
    await ins('admin@securepay.dev', 'SecurePay Admin', adminPw, 'admin', 2);
    const alice = await ins('alice@securepay.dev', 'Alice Khan', pw);
    const bob = await ins('bob@securepay.dev', 'Bob Ahmed', pw);
    const cafe = await ins('cafe@securepay.dev', 'Corner Cafe', pw, 'user', 2);

    const account = async (userId: string | null, cur: string, code?: string) => {
      const type = userId ? 'wallet' : 'system';
      const found = await client.query(
        userId ? `SELECT id FROM accounts WHERE user_id = $1 AND currency = $2 AND type = 'wallet'` : `SELECT id FROM accounts WHERE code = $1 AND currency = $2 AND type = 'system'`,
        [userId ?? code, cur],
      );
      if (found.rowCount) return found.rows[0].id as string;
      return (await client.query(`INSERT INTO accounts (user_id, type, code, currency) VALUES ($1, $2, $3, $4) RETURNING id`, [userId, type, code ?? null, cur])).rows[0].id as string;
    };
    const post = async (kind: string, initiator: string, desc: string, daysAgo: number, from: string, to: string, amount: number, cur: string, meta: object) => {
      const e = await client.query(
        `INSERT INTO journal_entries (kind, description, initiated_by, metadata, created_at) VALUES ($1, $2, $3, $4, now() - ($5 || ' days')::interval) RETURNING id`,
        [kind, desc, initiator, JSON.stringify(meta), String(daysAgo)],
      );
      for (const [acc, amt] of [[from, -amount], [to, amount]] as [string, number][]) {
        await client.query(`INSERT INTO postings (entry_id, account_id, amount, currency, created_at) VALUES ($1, $2, $3, $4, now() - ($5 || ' days')::interval)`, [e.rows[0].id, acc, amt, cur, String(daysAgo)]);
        await client.query(`UPDATE accounts SET balance = balance + $1 WHERE id = $2`, [amt, acc]);
      }
    };

    const fundingUsd = await account(null, 'USD', 'funding');
    const aliceUsd = await account(alice, 'USD');
    const bobUsd = await account(bob, 'USD');
    const cafeUsd = await account(cafe, 'USD');
    await account(alice, 'EUR');
    await post('deposit', alice, 'Top-up via sandbox', 90, fundingUsd, aliceUsd, 3_000_00, 'USD', { counterpartyName: 'Card top-up', amountUsdMinor: 3_000_00 });
    await post('deposit', bob, 'Top-up via sandbox', 90, fundingUsd, bobUsd, 1_500_00, 'USD', { counterpartyName: 'Card top-up', amountUsdMinor: 1_500_00 });

    const spend: [string, number, number][] = [
      ['Coffee and croissant', 6_50, 2], ['Lunch at Corner Cafe', 18_20, 5], ['Groceries', 74_10, 8], ['Uber ride home', 14_75, 9],
      ['Electricity bill', 62_00, 12], ['Netflix subscription', 15_49, 15], ['Dinner with friends', 48_00, 20], ['Pharmacy', 22_35, 24],
      ['Groceries', 81_40, 30], ['Bus pass', 40_00, 33], ['Movie tickets', 24_00, 38], ['Internet bill', 45_00, 42],
      ['Coffee', 4_80, 47], ['Groceries', 69_90, 55], ['Books for course', 36_00, 60], ['Restaurant', 52_30, 66],
    ];
    for (const [note, amount, days] of spend) {
      await post('qr_payment', alice, note, days, aliceUsd, cafeUsd, amount, 'USD', {
        recipientId: cafe, recipientName: 'Corner Cafe', senderId: alice, senderName: 'Alice Khan', note, amountUsdMinor: amount,
      });
    }
    await post('transfer', alice, 'Rent share', 28, aliceUsd, bobUsd, 400_00, 'USD', { recipientId: bob, recipientName: 'Bob Ahmed', senderId: alice, senderName: 'Alice Khan', note: 'Rent share', amountUsdMinor: 400_00 });
    await post('transfer', bob, 'Concert tickets', 10, bobUsd, aliceUsd, 60_00, 'USD', { recipientId: alice, recipientName: 'Alice Khan', senderId: bob, senderName: 'Bob Ahmed', note: 'Concert tickets', amountUsdMinor: 60_00 });
    await client.query('COMMIT');
    console.log('seeded: admin@securepay.dev / Admin12345, alice@securepay.dev / Password123, bob@securepay.dev / Password123');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
