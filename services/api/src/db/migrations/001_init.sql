-- SecurePay core schema.
-- Money is always stored as BIGINT in the currency's minor unit (cents, paisa...).
-- The ledger is double-entry: every journal entry has postings that sum to zero per currency.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT NOT NULL UNIQUE,
  phone           TEXT UNIQUE,
  full_name       TEXT NOT NULL,
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'frozen')),
  kyc_level       SMALLINT NOT NULL DEFAULT 0 CHECK (kyc_level BETWEEN 0 AND 2),
  base_currency   CHAR(3) NOT NULL DEFAULT 'USD',
  mfa_enabled     BOOLEAN NOT NULL DEFAULT FALSE,
  mfa_secret_enc  TEXT,
  failed_logins   INT NOT NULL DEFAULT 0,
  locked_until    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  device_id   TEXT,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE kyc_submissions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  full_name     TEXT NOT NULL,
  date_of_birth DATE NOT NULL,
  country       CHAR(2) NOT NULL,
  id_type       TEXT NOT NULL,
  id_number_last4 TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  provider_ref  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ledger accounts. Wallet accounts belong to users and may never go negative.
-- System accounts (funding, fees, fx, holds) represent the house side of the ledger.
CREATE TABLE accounts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE RESTRICT,
  type        TEXT NOT NULL CHECK (type IN ('wallet', 'system')),
  code        TEXT,
  currency    CHAR(3) NOT NULL,
  balance     BIGINT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT wallet_non_negative CHECK (type <> 'wallet' OR balance >= 0),
  CONSTRAINT wallet_has_user CHECK (type <> 'wallet' OR user_id IS NOT NULL)
);
CREATE UNIQUE INDEX accounts_wallet_unique ON accounts (user_id, currency) WHERE type = 'wallet';
CREATE UNIQUE INDEX accounts_system_unique ON accounts (code, currency) WHERE type = 'system';

CREATE TABLE journal_entries (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind             TEXT NOT NULL CHECK (kind IN ('deposit', 'withdrawal', 'transfer', 'fx', 'qr_payment', 'hold_release', 'hold_reversal')),
  status           TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'held', 'rejected')),
  description      TEXT,
  initiated_by     UUID REFERENCES users(id),
  idempotency_key  TEXT,
  parent_id        UUID REFERENCES journal_entries(id),
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX journal_idempotency ON journal_entries (initiated_by, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX journal_created ON journal_entries (created_at DESC);

CREATE TABLE postings (
  id          BIGSERIAL PRIMARY KEY,
  entry_id    UUID NOT NULL REFERENCES journal_entries(id) ON DELETE RESTRICT,
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  amount      BIGINT NOT NULL CHECK (amount <> 0),
  currency    CHAR(3) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX postings_account ON postings (account_id, created_at DESC);
CREATE INDEX postings_entry ON postings (entry_id);

CREATE TABLE payment_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id   UUID NOT NULL REFERENCES users(id),
  amount        BIGINT NOT NULL CHECK (amount > 0),
  currency      CHAR(3) NOT NULL,
  reference     TEXT,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'expired', 'cancelled')),
  payload       TEXT NOT NULL,
  paid_by       UUID REFERENCES users(id),
  entry_id      UUID REFERENCES journal_entries(id),
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE fraud_cases (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id),
  entry_id    UUID REFERENCES journal_entries(id),
  score       NUMERIC(5,4) NOT NULL,
  decision    TEXT NOT NULL CHECK (decision IN ('allow', 'challenge', 'review', 'block')),
  reasons     JSONB NOT NULL DEFAULT '[]'::jsonb,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'approved', 'rejected', 'logged')),
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  context     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX fraud_cases_status ON fraud_cases (status, created_at DESC);

CREATE TABLE budgets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category      TEXT NOT NULL,
  monthly_limit BIGINT NOT NULL CHECK (monthly_limit > 0),
  currency      CHAR(3) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, category, currency)
);

CREATE TABLE notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user ON notifications (user_id, created_at DESC);

-- Append-only audit trail. The trigger below rejects updates and deletes.
CREATE TABLE audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  actor_id    UUID,
  action      TEXT NOT NULL,
  target      TEXT,
  ip          TEXT,
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE FUNCTION audit_logs_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();

-- Postings are immutable too: corrections are new journal entries.
CREATE FUNCTION postings_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'postings are immutable; post a reversing entry instead';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER postings_no_update BEFORE UPDATE OR DELETE ON postings
  FOR EACH ROW EXECUTE FUNCTION postings_immutable();
