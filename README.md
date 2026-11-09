# ZenPay

An AI-powered digital wallet with QR and MFA authentication, multi-currency wallets, QR payments, AI financial guidance and fraud detection.

```
apps/
  web/       Next.js 15 web app: customer wallet + admin console
  mobile/    Flutter app for Android and iOS
services/
  api/       NestJS (TypeScript) core API: auth, ledger, wallets, payments, fraud, admin
  ai/        FastAPI (Python) service: fraud model, spending insights, Claude assistant
docker-compose.yml
```

## Architecture

```
 Web (Next.js) ─┐                       ┌─ PostgreSQL  (users, double-entry ledger, audit log)
                ├─ HTTPS/JSON ─► API ───┼─ Redis       (MFA replay guard, QR login sessions, locks)
 Mobile (Flutter)┘   (NestJS)           └─ AI service  (fraud score, insights, assistant) ─► Claude API
```

- **The API is the only public service.** The AI service is internal and only receives de-identified data (no ids, emails or account numbers).
- **All money moves through one double-entry ledger** (`services/api/src/modules/ledger`). Each journal entry's postings sum to zero per currency. Wallet balances can't go negative (database `CHECK`). Postings and audit logs are immutable (database triggers). Every payment takes an idempotency key, so a retried request never charges twice.
- **Real funds are held by a licensed partner.** `PaymentProvider` is the boundary. The repo ships a `SandboxPaymentProvider`; swap in Stripe, Adyen or a local bank to go live.

## Features

| Area | What's implemented |
|---|---|
| Authentication | Email + password (Argon2id), JWT access tokens (15 min) with rotating one-time refresh tokens, lockout after 5 failed logins, rate limiting |
| MFA | TOTP (RFC 6238, works with Google Authenticator, Authy, 1Password). Secrets are AES-256-GCM encrypted at rest; codes can't be replayed. Step-up MFA is required for payments of $1,000 or more and for risky payments |
| QR login | Web shows a short-lived QR code; the signed-in phone scans and approves it; the web session gets one-time tokens through a secret-protected poll |
| Wallets | 7 currencies (USD, EUR, GBP, PKR, AED, INR, JPY). Sandbox top-ups, withdrawals (identity verification required), conversion with live or built-in rates and a 0.5% spread booked as fee revenue |
| Payments | P2P transfers by email or phone. **EMVCo merchant QR** codes: dynamic single-use requests with a fixed amount, and a static personal "pay me" code. The CRC is validated and amount and currency are re-checked server-side against the stored request |
| Fraud detection | Rules engine (velocity, amount spikes, new account, new recipient, unknown device, odd hours) **plus** an ML score (gradient boosting + isolation forest). Each payment is allowed, challenged with MFA, held for analyst review (funds moved to a holds account), or blocked |
| Limits & KYC | Daily limits by verification level ($100 / $5,000 / $50,000). Pluggable KYC provider; only the last 4 characters of an ID number are stored |
| AI guidance | Automatic categorisation, monthly trends, next-month forecast, budgets with pace tracking, personalised tips, and a chat assistant on **Claude** (falls back to built-in answers without an API key) |
| Admin | Live stats, fraud review queue (approve and release / reject and refund), user freeze and KYC level, ledger browser, append-only audit log |

## Run it locally

### Option A: Docker (everything in one command)

```bash
docker compose up --build
```

Then load demo data:

```bash
docker compose exec api node dist/db/seed.js
```

Open http://localhost:3000. API docs (Swagger) are at http://localhost:4000/docs.

To enable the Claude-powered assistant, create a `.env` file next to `docker-compose.yml` containing `ANTHROPIC_API_KEY=...`.

### Option B: run each service yourself

You need Node 22, Python 3.12+, PostgreSQL 16 and Redis 7.

```bash
createdb zenpay
```

```bash
cd services/ai && python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt && .venv/bin/uvicorn app.main:app --port 8000
```

```bash
cd services/api && cp .env.example .env && npm install && npm run seed && npm run dev
```

```bash
cd apps/web && cp .env.example .env.local && npm install && npm run dev
```

The API loads `services/api/.env` on start. Edit `DATABASE_URL` there to match your Postgres.

### Demo accounts (after seeding)

| Email | Password | Notes |
|---|---|---|
| `alice@zenpay.dev` | `Password123` | Customer with 3 months of history |
| `bob@zenpay.dev` | `Password123` | Customer |
| `cafe@zenpay.dev` | `Password123` | Merchant |
| `admin@zenpay.dev` | `Admin12345` | Admin console at `/admin` |

Sandbox tip: a top-up whose cents end in `.13` (for example `5.13`) is declined, so you can test the failure path.

### Mobile app

The `apps/mobile` folder contains the Dart source. Generate the platform folders once, then run:

```bash
cd apps/mobile && flutter create --platforms=android,ios . && flutter pub get
```

```bash
flutter run --dart-define=API_URL=http://10.0.2.2:4000/api/v1
```

`10.0.2.2` is how the Android emulator reaches your computer; use your machine's LAN IP for a real phone. For iOS, add an `NSCameraUsageDescription` entry to `ios/Runner/Info.plist` so QR scanning can use the camera.

## Tests

```bash
cd services/api && npm test
```

Runs 23 unit and end-to-end tests against a real Postgres and Redis (`TEST_DATABASE_URL`, default `postgres://postgres@localhost:5432/zenpay_test`, which is wiped). They cover auth, MFA, QR login, idempotency, concurrent transfers keeping the ledger balanced, FX, KYC limits, QR payments, fraud holds and admin review.

```bash
cd services/ai && .venv/bin/python -m pytest -q
```

```bash
cd apps/mobile && flutter analyze && flutter test
```

CI runs all of these on every push (`.github/workflows/ci.yml`).

## Fraud model

The model ships bootstrapped on a **synthetic** dataset that encodes common fraud patterns (account takeover, mule accounts, card testing), with label noise added. Hold-out ROC-AUC is about 0.86. That number describes the synthetic data, not real-world performance. Once you have real outcomes, export resolved fraud cases (approved = 0, rejected = 1) with their features and retrain:

```bash
cd services/ai && python -m scripts.train_fraud_model --data labelled.csv
```

## Going to production: checklist

- [ ] Partner with a licensed bank / payment institution and implement `PaymentProvider` against it
- [ ] Replace the sandbox KYC check in `KycService` with a real provider (Onfido, Sumsub, Veriff) and its webhooks
- [ ] Generate real secrets (`JWT_SECRET`, `JWT_REFRESH_SECRET`, `DATA_ENCRYPTION_KEY`) and keep them in a secrets manager / KMS
- [ ] Put the API behind TLS and a WAF; keep the AI service, Postgres and Redis on a private network
- [ ] Enable Postgres backups and point-in-time recovery
- [ ] Retrain the fraud model on real labelled data and tune the thresholds in `fraud.service.ts`
- [ ] Add SMS/email OTP and push notifications if needed
- [ ] Get an independent security review and penetration test
