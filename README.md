# SecurePay

An AI-powered digital wallet with QR and MFA authentication, multi-currency wallets, QR payments, AI financial guidance and fraud detection.

```
apps/
  web/       Next.js 15 web app: customer wallet + admin console
  mobile/    Flutter app for Android and iOS
services/
  api/       NestJS (TypeScript) core API: auth, ledger, wallets, payments, fraud, admin
  ai/        FastAPI (Python) service: fraud model, spending insights, AI assistant
docker-compose.yml
```

## Screenshots

Captured from the running app (web app, API and AI service together) with demo data. Click any image to open it full size.

### Sign in

<table>
  <tr>
    <td width="50%" valign="top"><a href="docs/screenshots/01-register.jpg"><img src="docs/screenshots/01-register.jpg" alt="Create an account"></a><br><b>Create an account</b><br>Name, email, phone and home currency. A wallet opens automatically.</td>
    <td width="50%" valign="top"><a href="docs/screenshots/02-login-password.jpg"><img src="docs/screenshots/02-login-password.jpg" alt="Sign in with a password"></a><br><b>Sign in with a password</b><br>Five wrong attempts lock the account for 15 minutes.</td>
  </tr>
  <tr>
    <td width="50%" valign="top"><a href="docs/screenshots/03-login-qr.jpg"><img src="docs/screenshots/03-login-qr.jpg" alt="Or sign in by QR code"></a><br><b>Or sign in by QR code</b><br>Scan with the signed-in phone app; no password typed.</td>
    <td width="50%" valign="top"><a href="docs/screenshots/04-login-mfa.jpg"><img src="docs/screenshots/04-login-mfa.jpg" alt="Two-factor code"></a><br><b>Two-factor code</b><br>With MFA on, the authenticator code is also required.</td>
  </tr>
</table>

### Home and sending money

<table>
  <tr>
    <td width="50%" valign="top"><a href="docs/screenshots/05-dashboard.jpg"><img src="docs/screenshots/05-dashboard.jpg" alt="Home"></a><br><b>Home</b><br>Total balance, wallets, recent activity and notifications.</td>
    <td width="50%" valign="top"><a href="docs/screenshots/06-send-form.jpg"><img src="docs/screenshots/06-send-form.jpg" alt="Find someone and enter an amount"></a><br><b>Find someone and enter an amount</b><br>Look up by email or phone; their email is partly hidden.</td>
  </tr>
  <tr>
    <td width="50%" valign="top"><a href="docs/screenshots/07-send-mfa.jpg"><img src="docs/screenshots/07-send-mfa.jpg" alt="Step-up check"></a><br><b>Step-up check</b><br>Payments of $1,000 or more need an authenticator code.</td>
    <td width="50%" valign="top"><a href="docs/screenshots/08-send-done.jpg"><img src="docs/screenshots/08-send-done.jpg" alt="Sent"></a><br><b>Sent</b><br>Instant, and the recipient is notified.</td>
  </tr>
</table>

### QR payments

<table>
  <tr>
    <td width="50%" valign="top"><a href="docs/screenshots/09-qr-receive.jpg"><img src="docs/screenshots/09-qr-receive.jpg" alt="Shop creates a payment QR"></a><br><b>Shop creates a payment QR</b><br>Standard bank QR format (EMVCo), single-use, valid 15 minutes.</td>
    <td width="50%" valign="top"><a href="docs/screenshots/10-qr-pay-start.jpg"><img src="docs/screenshots/10-qr-pay-start.jpg" alt="Customer opens Pay"></a><br><b>Customer opens Pay</b><br>Scan with the camera or paste the QR text.</td>
  </tr>
  <tr>
    <td width="50%" valign="top"><a href="docs/screenshots/11-qr-pay-confirm.jpg"><img src="docs/screenshots/11-qr-pay-confirm.jpg" alt="Check before paying"></a><br><b>Check before paying</b><br>The server re-checks the amount, so an edited QR is rejected.</td>
    <td width="50%" valign="top"><a href="docs/screenshots/12-qr-pay-done.jpg"><img src="docs/screenshots/12-qr-pay-done.jpg" alt="Paid"></a><br><b>Paid</b><br>Paying the same QR twice is refused.</td>
  </tr>
  <tr>
    <td width="50%" valign="top"><a href="docs/screenshots/13-qr-receive-paid.jpg"><img src="docs/screenshots/13-qr-receive-paid.jpg" alt="Shop sees it paid"></a><br><b>Shop sees it paid</b><br>The request updates to paid on its own.</td>
    <td width="50%"></td>
  </tr>
</table>

### Multi-currency

<table>
  <tr>
    <td width="50%" valign="top"><a href="docs/screenshots/14-wallet-convert-quote.jpg"><img src="docs/screenshots/14-wallet-convert-quote.jpg" alt="Live quote"></a><br><b>Live quote</b><br>Rate, the 0.5% fee and exactly what arrives.</td>
    <td width="50%" valign="top"><a href="docs/screenshots/15-wallet-convert-done.jpg"><img src="docs/screenshots/15-wallet-convert-done.jpg" alt="Converted"></a><br><b>Converted</b><br>The new currency wallet opens automatically.</td>
  </tr>
</table>

### Activity, AI guidance and security

<table>
  <tr>
    <td width="50%" valign="top"><a href="docs/screenshots/16-activity.jpg"><img src="docs/screenshots/16-activity.jpg" alt="Activity"></a><br><b>Activity</b><br>Every payment, top-up and conversion.</td>
    <td width="50%" valign="top"><a href="docs/screenshots/17-insights.jpg"><img src="docs/screenshots/17-insights.jpg" alt="Insights and the assistant"></a><br><b>Insights and the assistant</b><br>Charts, categories, forecast, budgets, tips and chat.</td>
  </tr>
  <tr>
    <td width="50%" valign="top"><a href="docs/screenshots/18-security-mfa-setup.jpg"><img src="docs/screenshots/18-security-mfa-setup.jpg" alt="Turn on MFA"></a><br><b>Turn on MFA</b><br>Scan with an authenticator app, then confirm with a code.</td>
    <td width="50%"></td>
  </tr>
</table>

### Fraud protection and the admin console

<table>
  <tr>
    <td width="50%" valign="top"><a href="docs/screenshots/19-fraud-held.jpg"><img src="docs/screenshots/19-fraud-held.jpg" alt="Payment held for review"></a><br><b>Payment held for review</b><br>An unusual payment is reserved until a person checks it.</td>
    <td width="50%" valign="top"><a href="docs/screenshots/20-admin-overview.jpg"><img src="docs/screenshots/20-admin-overview.jpg" alt="Admin overview"></a><br><b>Admin overview</b><br>Users, 24-hour volume, open fraud cases, 14-day chart.</td>
  </tr>
  <tr>
    <td width="50%" valign="top"><a href="docs/screenshots/21-admin-fraud-review.jpg"><img src="docs/screenshots/21-admin-fraud-review.jpg" alt="Fraud review"></a><br><b>Fraud review</b><br>Risk score, reasons and signals; approve or reject.</td>
    <td width="50%" valign="top"><a href="docs/screenshots/25-fraud-approved-notice.jpg"><img src="docs/screenshots/25-fraud-approved-notice.jpg" alt="Customer is told"></a><br><b>Customer is told</b><br>After approval the payment completes and the customer is notified.</td>
  </tr>
  <tr>
    <td width="50%" valign="top"><a href="docs/screenshots/22-admin-users.jpg"><img src="docs/screenshots/22-admin-users.jpg" alt="Users"></a><br><b>Users</b><br>Search, change verification level, freeze accounts.</td>
    <td width="50%" valign="top"><a href="docs/screenshots/23-admin-ledger.jpg"><img src="docs/screenshots/23-admin-ledger.jpg" alt="Ledger"></a><br><b>Ledger</b><br>Every money movement with status and risk score.</td>
  </tr>
  <tr>
    <td width="50%" valign="top"><a href="docs/screenshots/24-admin-audit.jpg"><img src="docs/screenshots/24-admin-audit.jpg" alt="Audit log"></a><br><b>Audit log</b><br>Security and money events; edits and deletions are refused.</td>
    <td width="50%"></td>
  </tr>
</table>

### On a phone

<table>
  <tr>
    <td width="50%" valign="top"><a href="docs/screenshots/26-mobile-dashboard.jpg"><img src="docs/screenshots/26-mobile-dashboard.jpg" alt="Home"></a><br><b>Home</b><br>The web app at phone width.</td>
    <td width="50%" valign="top"><a href="docs/screenshots/27-mobile-receive.jpg"><img src="docs/screenshots/27-mobile-receive.jpg" alt="Personal QR code"></a><br><b>Personal QR code</b><br>Anyone can scan it to pay you.</td>
  </tr>
</table>

## Architecture

```
 Web (Next.js) ─┐                       ┌─ PostgreSQL  (users, double-entry ledger, audit log)
                ├─ HTTPS/JSON ─► API ───┼─ Redis       (MFA replay guard, QR login sessions, locks)
 Mobile (Flutter)┘   (NestJS)           └─ AI service  (fraud score, insights, assistant) ─► LLM API
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
| AI guidance | Automatic categorisation, monthly trends, next-month forecast, budgets with pace tracking, personalised tips, and a chat assistant on a hosted **large language model** (falls back to built-in answers without an API key) |
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

To enable the language-model assistant, create a `.env` file next to `docker-compose.yml` containing `ASSISTANT_API_KEY=...`.

### Option B: run each service yourself

You need Node 22, Python 3.12+, PostgreSQL 16 and Redis 7.

```bash
createdb securepay
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
| `alice@securepay.dev` | `Password123` | Customer with 3 months of history |
| `bob@securepay.dev` | `Password123` | Customer |
| `cafe@securepay.dev` | `Password123` | Merchant |
| `admin@securepay.dev` | `Admin12345` | Admin console at `/admin` |

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

Runs 24 unit and end-to-end tests against a real Postgres and Redis (`TEST_DATABASE_URL`, default `postgres://postgres@localhost:5432/securepay_test`, which is wiped). They cover auth, MFA, QR login, idempotency, concurrent transfers keeping the ledger balanced, FX, KYC limits, QR payments, fraud holds and admin review.

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
