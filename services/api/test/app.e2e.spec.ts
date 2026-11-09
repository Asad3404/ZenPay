/**
 * End-to-end tests against a real PostgreSQL and Redis.
 * Uses TEST_DATABASE_URL (default postgres://postgres@localhost:5432/securepay_test), which is wiped first.
 */
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/securepay_test';
process.env.AI_SERVICE_URL = '';
process.env.FX_RATES_URL = '';
process.env.DISABLE_RATE_LIMIT = 'true';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { decrypt } from '../src/common/crypto';
import { totp } from '../src/common/totp';
import { migrate } from '../src/db/migrate';

let app: INestApplication;
let pool: Pool;
const api = () => request(app.getHttpServer());
const key = () => randomUUID();

async function register(email: string, extra: Record<string, unknown> = {}) {
  const res = await api().post('/api/v1/auth/register').send({ email, password: 'Password123', fullName: email.split('@')[0], ...extra });
  expect(res.status).toBe(201);
  return res.body as { accessToken: string; refreshToken: string; user: { id: string } };
}

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function deposit(token: string, amount: string, currency = 'USD') {
  const res = await api().post('/api/v1/wallets/deposit').set(auth(token)).send({ amount, currency, idempotencyKey: key() });
  expect(res.status).toBe(201);
  return res.body;
}

async function currentCode(userId: string) {
  const row = (await pool.query('SELECT mfa_secret_enc FROM users WHERE id = $1', [userId])).rows[0];
  return totp(decrypt(row.mfa_secret_enc));
}

beforeAll(async () => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(process.env.DATABASE_URL, () => undefined);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(moduleRef.createNestApplication());
  await app.init();
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
});

describe('auth', () => {
  it('registers, logs in, refreshes with rotation and rejects bad passwords', async () => {
    const reg = await register('carol@test.dev');
    expect(reg.accessToken).toBeTruthy();

    const dup = await api().post('/api/v1/auth/register').send({ email: 'carol@test.dev', password: 'Password123', fullName: 'Carol' });
    expect(dup.status).toBe(409);

    const weak = await api().post('/api/v1/auth/register').send({ email: 'weak@test.dev', password: 'short', fullName: 'W' });
    expect(weak.status).toBe(400);

    const bad = await api().post('/api/v1/auth/login').send({ email: 'carol@test.dev', password: 'WrongPass1' });
    expect(bad.status).toBe(401);

    const login = await api().post('/api/v1/auth/login').send({ email: 'carol@test.dev', password: 'Password123' });
    expect(login.status).toBe(200);

    const r1 = await api().post('/api/v1/auth/refresh').send({ refreshToken: login.body.refreshToken });
    expect(r1.status).toBe(200);
    const reuse = await api().post('/api/v1/auth/refresh').send({ refreshToken: login.body.refreshToken });
    expect(reuse.status).toBe(401);

    const me = await api().get('/api/v1/me').set(auth(r1.body.accessToken));
    expect(me.body.email).toBe('carol@test.dev');
    expect((await api().get('/api/v1/me')).status).toBe(401);
  });

  it('enables TOTP MFA and requires it at login', async () => {
    const u = await register('mfa@test.dev');
    const setup = await api().post('/api/v1/auth/mfa/setup').set(auth(u.accessToken));
    expect(setup.body.otpauthUrl).toContain('otpauth://totp/');
    const wrong = await api().post('/api/v1/auth/mfa/enable').set(auth(u.accessToken)).send({ code: '000000' });
    expect(wrong.status).toBe(400);
    const ok = await api().post('/api/v1/auth/mfa/enable').set(auth(u.accessToken)).send({ code: totp(setup.body.secret) });
    expect(ok.body.mfaEnabled).toBe(true);

    const step1 = await api().post('/api/v1/auth/login').send({ email: 'mfa@test.dev', password: 'Password123' });
    expect(step1.body.mfaRequired).toBe(true);
    expect(step1.body.accessToken).toBeUndefined();
    // The code used to enable MFA cannot be replayed within its window.
    const replay = await api().post('/api/v1/auth/mfa/verify').send({ mfaToken: step1.body.mfaToken, code: totp(setup.body.secret) });
    expect(replay.status).toBe(401);
    // Next window's code is accepted (drift tolerance covers +1 step).
    const nextCode = totp(setup.body.secret, Date.now() + 30_000);
    const step2 = await api().post('/api/v1/auth/mfa/verify').send({ mfaToken: step1.body.mfaToken, code: nextCode });
    expect(step2.status).toBe(200);
    expect(step2.body.accessToken).toBeTruthy();
  });

  it('signs in on the web by approving a QR code from the phone', async () => {
    const phone = await register('qrlogin@test.dev');
    const session = await api().post('/api/v1/auth/qr/session');
    expect(session.body.qrPayload).toContain(session.body.sessionId);
    const pending = await api().post(`/api/v1/auth/qr/session/${session.body.sessionId}/poll`).send({ pollSecret: session.body.pollSecret });
    expect(pending.body.status).toBe('pending');
    const stolen = await api().post(`/api/v1/auth/qr/session/${session.body.sessionId}/poll`).send({ pollSecret: 'not-the-secret' });
    expect(stolen.status).toBe(403);
    await api().post('/api/v1/auth/qr/approve').set(auth(phone.accessToken)).send({ sessionId: session.body.sessionId }).expect(200);
    const done = await api().post(`/api/v1/auth/qr/session/${session.body.sessionId}/poll`).send({ pollSecret: session.body.pollSecret });
    expect(done.body.status).toBe('approved');
    expect(done.body.user.id).toBe(phone.user.id);
    const again = await api().post(`/api/v1/auth/qr/session/${session.body.sessionId}/poll`).send({ pollSecret: session.body.pollSecret });
    expect(again.body.status).toBe('expired');
  });
});

describe('wallets and ledger', () => {
  it('tops up, transfers, is idempotent and never overdraws', async () => {
    const a = await register('sender@test.dev');
    const b = await register('receiver@test.dev');
    await deposit(a.accessToken, '80.00');
    const declined = await api().post('/api/v1/wallets/deposit').set(auth(a.accessToken)).send({ amount: '5.13', currency: 'USD', idempotencyKey: key() });
    expect(declined.status).toBe(402);

    const lookup = await api().get('/api/v1/transfers/lookup').query({ q: 'receiver@test.dev' }).set(auth(a.accessToken));
    expect(lookup.body.id).toBe(b.user.id);

    const k = key();
    const body = { recipientId: b.user.id, amount: '25.50', currency: 'USD', note: 'Dinner', idempotencyKey: k };
    const t1 = await api().post('/api/v1/transfers').set(auth(a.accessToken)).send(body);
    expect(t1.status).toBe(201);
    expect(t1.body.status).toBe('completed');
    const t2 = await api().post('/api/v1/transfers').set(auth(a.accessToken)).send(body);
    expect(t2.body.id).toBe(t1.body.id);
    expect(t2.body.replayed).toBe(true);

    const wa = await api().get('/api/v1/wallets').set(auth(a.accessToken));
    const wb = await api().get('/api/v1/wallets').set(auth(b.accessToken));
    expect(wa.body.wallets[0].balance).toBe('54.50');
    expect(wb.body.wallets[0].balance).toBe('25.50');

    const over = await api().post('/api/v1/transfers').set(auth(a.accessToken)).send({ ...body, amount: '60.00', idempotencyKey: key() });
    expect(over.status).toBe(400);
    expect(over.body.message).toBe('Insufficient funds');

    const self = await api().post('/api/v1/transfers').set(auth(a.accessToken)).send({ ...body, recipientId: a.user.id, idempotencyKey: key() });
    expect(self.status).toBe(400);

    const hist = await api().get('/api/v1/wallets/transactions').set(auth(b.accessToken));
    expect(hist.body[0]).toMatchObject({ direction: 'in', amount: '25.50', counterparty: 'sender' });

    const notes = await api().get('/api/v1/notifications').set(auth(b.accessToken));
    expect(notes.body[0].title).toBe('Money received');
  });

  it('keeps the ledger balanced under concurrent transfers', async () => {
    const a = await register('race-a@test.dev');
    const b = await register('race-b@test.dev');
    await deposit(a.accessToken, '50.00');
    const attempts = await Promise.all(
      Array.from({ length: 8 }, () =>
        api().post('/api/v1/transfers').set(auth(a.accessToken)).send({ recipientId: b.user.id, amount: '10.00', currency: 'USD', idempotencyKey: key() }),
      ),
    );
    const ok = attempts.filter((r) => r.status === 201).length;
    expect(ok).toBe(5);
    const wa = await api().get('/api/v1/wallets').set(auth(a.accessToken));
    expect(wa.body.wallets[0].balance).toBe('0.00');
    const sums = await pool.query('SELECT currency, sum(amount)::bigint AS s FROM postings GROUP BY currency');
    for (const row of sums.rows) expect(Number(row.s)).toBe(0);
    const accountDrift = await pool.query(
      'SELECT count(*) FROM accounts a WHERE a.balance <> COALESCE((SELECT sum(amount) FROM postings p WHERE p.account_id = a.id), 0)',
    );
    expect(Number(accountDrift.rows[0].count)).toBe(0);
  });

  it('converts currencies with a booked fee', async () => {
    const u = await register('fx@test.dev');
    await deposit(u.accessToken, '100.00');
    const quote = await api().get('/api/v1/fx/quote').query({ from: 'USD', to: 'EUR', amount: '100.00' });
    expect(quote.body.fee).toBe('0.50');
    const res = await api().post('/api/v1/wallets/convert').set(auth(u.accessToken)).send({ amount: '100.00', from: 'USD', to: 'EUR', idempotencyKey: key() });
    expect(res.status).toBe(201);
    expect(res.body.received).toBe(`${quote.body.receive} EUR`);
    const w = await api().get('/api/v1/wallets').set(auth(u.accessToken));
    const eur = w.body.wallets.find((x: any) => x.currency === 'EUR');
    expect(eur.balance).toBe(quote.body.receive);
  });

  it('enforces KYC for withdrawals and daily limits', async () => {
    const u = await register('kyc@test.dev');
    await deposit(u.accessToken, '500.00');
    const blocked = await api().post('/api/v1/wallets/withdraw').set(auth(u.accessToken)).send({ amount: '10.00', currency: 'USD', idempotencyKey: key() });
    expect(blocked.body.code).toBe('KYC_REQUIRED');

    const r = await register('limit-r@test.dev');
    const limit = await api().post('/api/v1/transfers').set(auth(u.accessToken)).send({ recipientId: r.user.id, amount: '150.00', currency: 'USD', idempotencyKey: key() });
    expect(limit.body.code).toBe('LIMIT_EXCEEDED');

    const kyc = await api().post('/api/v1/kyc').set(auth(u.accessToken)).send({ fullName: 'Kyc User', dateOfBirth: '1990-01-01', country: 'PK', idType: 'passport', idNumber: 'AB1234567' });
    expect(kyc.body.level).toBe(1);
    const w = await api().post('/api/v1/wallets/withdraw').set(auth(u.accessToken)).send({ amount: '10.00', currency: 'USD', idempotencyKey: key() });
    expect(w.status).toBe(201);
    expect(w.body.payoutReference).toMatch(/^po_/);
  });
});

describe('QR payments', () => {
  it('pays a dynamic merchant QR exactly once', async () => {
    const shop = await register('shop@test.dev');
    const buyer = await register('buyer@test.dev');
    await deposit(buyer.accessToken, '40.00');
    const req = await api().post('/api/v1/payments/requests').set(auth(shop.accessToken)).send({ amount: '12.50', currency: 'USD', reference: 'ORDER-1' });
    expect(req.status).toBe(201);
    expect(req.body.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);

    const parsed = await api().post('/api/v1/payments/qr/parse').set(auth(buyer.accessToken)).send({ payload: req.body.payload });
    expect(parsed.body).toMatchObject({ type: 'dynamic', amount: '12.50', currency: 'USD' });

    const tampered = req.body.payload.replace('540512.50', '54041.00');
    const bad = await api().post('/api/v1/payments/qr/parse').set(auth(buyer.accessToken)).send({ payload: tampered });
    expect(bad.status).toBe(400);

    const pay = await api().post('/api/v1/payments/qr/pay').set(auth(buyer.accessToken)).send({ payload: req.body.payload, idempotencyKey: key() });
    expect(pay.status).toBe(201);
    const again = await api().post('/api/v1/payments/qr/pay').set(auth(buyer.accessToken)).send({ payload: req.body.payload, idempotencyKey: key() });
    expect(again.status).toBe(409);

    const list = await api().get('/api/v1/payments/requests').set(auth(shop.accessToken));
    expect(list.body[0].status).toBe('paid');
  });

  it('pays a static personal QR with a chosen amount', async () => {
    const payee = await register('payee@test.dev');
    const payer = await register('payer@test.dev');
    await deposit(payer.accessToken, '20.00');
    const qr = await api().get('/api/v1/payments/my-qr').set(auth(payee.accessToken));
    const missing = await api().post('/api/v1/payments/qr/pay').set(auth(payer.accessToken)).send({ payload: qr.body.payload, idempotencyKey: key() });
    expect(missing.status).toBe(400);
    const ok = await api().post('/api/v1/payments/qr/pay').set(auth(payer.accessToken)).send({ payload: qr.body.payload, amount: '7.00', idempotencyKey: key() });
    expect(ok.status).toBe(201);
  });
});

describe('fraud controls and admin review', () => {
  let adminToken: string;

  beforeAll(async () => {
    const admin = await register('admin@test.dev');
    await pool.query(`UPDATE users SET role = 'admin', kyc_level = 2 WHERE id = $1`, [admin.user.id]);
    adminToken = admin.accessToken;
  });

  it('requires MFA setup for large payments and an MFA code once enabled', async () => {
    const rich = await register('rich@test.dev');
    const friend = await register('friend@test.dev');
    await pool.query(`UPDATE users SET kyc_level = 2, created_at = now() - interval '200 days' WHERE id = $1`, [rich.user.id]);
    await deposit(rich.accessToken, '5000.00');
    // Build a normal history to the same recipient so only the amount rule matters.
    for (let i = 0; i < 2; i++) {
      await api().post('/api/v1/transfers').set(auth(rich.accessToken)).send({ recipientId: friend.user.id, amount: '400.00', currency: 'USD', idempotencyKey: key() }).expect(201);
    }
    const body = { recipientId: friend.user.id, amount: '1200.00', currency: 'USD', idempotencyKey: key() };
    const noMfa = await api().post('/api/v1/transfers').set(auth(rich.accessToken)).send(body);
    expect(noMfa.body.code).toBe('MFA_SETUP_REQUIRED');

    const setup = await api().post('/api/v1/auth/mfa/setup').set(auth(rich.accessToken));
    await api().post('/api/v1/auth/mfa/enable').set(auth(rich.accessToken)).send({ code: totp(setup.body.secret) }).expect(200);
    const needCode = await api().post('/api/v1/transfers').set(auth(rich.accessToken)).send(body);
    expect(needCode.body.code).toBe('MFA_REQUIRED');
    const withCode = await api()
      .post('/api/v1/transfers')
      .set(auth(rich.accessToken))
      .send({ ...body, mfaCode: totp(setup.body.secret, Date.now() + 30_000) });
    expect(withCode.status).toBe(201);
    expect(withCode.body.status).toBe('completed');
  });

  it('holds risky payments for review; admin can approve or reject', async () => {
    const newbie = await register('newbie@test.dev');
    const target = await register('target@test.dev');
    await pool.query(`UPDATE users SET kyc_level = 2 WHERE id = $1`, [newbie.user.id]);
    await deposit(newbie.accessToken, '2000.00');
    // Brand-new account + large amount + first-time recipient + unknown device => review (no MFA => hold).
    const risky = await api().post('/api/v1/transfers').set(auth(newbie.accessToken)).set('x-device-id', 'new-device').send({ recipientId: target.user.id, amount: '900.00', currency: 'USD', idempotencyKey: key() });
    expect(risky.status).toBe(201);
    expect(risky.body.status).toBe('held');
    expect(risky.body.fraud.reasons.length).toBeGreaterThan(0);

    let tw = await api().get('/api/v1/wallets').set(auth(target.accessToken));
    expect(tw.body.wallets[0].balance).toBe('0.00');

    const cases = await api().get('/api/v1/admin/fraud-cases').query({ status: 'open' }).set(auth(adminToken));
    const c = cases.body.find((x: any) => x.entryId === risky.body.id);
    expect(c).toBeTruthy();

    const forbidden = await api().get('/api/v1/admin/fraud-cases').set(auth(newbie.accessToken));
    expect(forbidden.status).toBe(403);

    await api().post(`/api/v1/admin/fraud-cases/${c.id}/approve`).set(auth(adminToken)).expect(200);
    tw = await api().get('/api/v1/wallets').set(auth(target.accessToken));
    expect(tw.body.wallets[0].balance).toBe('900.00');

    // A second held payment gets rejected and refunded.
    const risky2 = await api().post('/api/v1/transfers').set(auth(newbie.accessToken)).set('x-device-id', 'new-device-2').send({ recipientId: (await register('target2@test.dev')).user.id, amount: '800.00', currency: 'USD', idempotencyKey: key() });
    expect(risky2.body.status).toBe('held');
    const cases2 = await api().get('/api/v1/admin/fraud-cases').query({ status: 'open' }).set(auth(adminToken));
    const c2 = cases2.body.find((x: any) => x.entryId === risky2.body.id);
    await api().post(`/api/v1/admin/fraud-cases/${c2.id}/reject`).set(auth(adminToken)).expect(200);
    const nw = await api().get('/api/v1/wallets').set(auth(newbie.accessToken));
    expect(nw.body.wallets[0].balance).toBe('1100.00');
  });

  it('lets admins freeze accounts and see stats and audit logs', async () => {
    const bad = await register('bad@test.dev');
    await api().patch(`/api/v1/admin/users/${bad.user.id}/status`).set(auth(adminToken)).send({ status: 'frozen' }).expect(200);
    const blocked = await api().get('/api/v1/me').set(auth(bad.accessToken));
    expect(blocked.status).toBe(403);
    const stats = await api().get('/api/v1/admin/stats').set(auth(adminToken));
    expect(stats.body.users).toBeGreaterThan(5);
    expect(stats.body.daily).toHaveLength(14);
    const logs = await api().get('/api/v1/admin/audit-logs').set(auth(adminToken));
    expect(logs.body.some((l: any) => l.action === 'admin.user_frozen')).toBe(true);
    await expect(pool.query('DELETE FROM audit_logs')).rejects.toThrow('append-only');
  });
});

describe('insights without AI service', () => {
  it('returns 503 when the AI service is not configured, and manages budgets', async () => {
    const u = await register('budget@test.dev');
    const res = await api().get('/api/v1/insights').set(auth(u.accessToken));
    expect(res.status).toBe(503);
    const b = await api().post('/api/v1/insights/budgets').set(auth(u.accessToken)).send({ category: 'Groceries', monthlyLimit: '300.00', currency: 'USD' });
    expect(b.body[0]).toMatchObject({ category: 'Groceries', monthlyLimit: '300.00' });
  });
});

describe('health', () => {
  it('reports ok', async () => {
    const res = await api().get('/health');
    expect(res.body.status).toBe('ok');
  });
});
