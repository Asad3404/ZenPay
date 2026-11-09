from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app import assistant
from app.fraud import FraudModel, synthetic_dataset
from app.insights import analyze, categorize, forecast_next
from app.main import app

NORMAL = {
    "amount_usd": 25, "account_age_days": 300, "tx_count_1h": 0, "tx_count_24h": 2, "amount_sum_24h_usd": 40,
    "avg_amount_90d_usd": 30, "is_new_recipient": 0, "is_known_device": 1, "kyc_level": 1, "hour_of_day": 14,
}
TAKEOVER = {
    "amount_usd": 2400, "account_age_days": 400, "tx_count_1h": 2, "tx_count_24h": 4, "amount_sum_24h_usd": 3000,
    "avg_amount_90d_usd": 35, "is_new_recipient": 1, "is_known_device": 0, "kyc_level": 1, "hour_of_day": 3,
}


@pytest.fixture(scope="module")
def client(monkeypatch_module):
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def monkeypatch_module():
    mp = pytest.MonkeyPatch()
    mp.delenv("ASSISTANT_API_KEY", raising=False)
    yield mp
    mp.undo()


def test_model_quality_on_holdout():
    model = FraudModel.train(*synthetic_dataset(12_000, seed=11), seed=11)
    assert model.metrics["roc_auc"] > 0.8
    assert model.metrics["average_precision"] > 0.5


def test_fraud_endpoint_separates_normal_and_takeover(client):
    low = client.post("/v1/fraud/score", json=NORMAL).json()
    high = client.post("/v1/fraud/score", json=TAKEOVER).json()
    assert low["score"] < 0.3
    assert high["score"] > 0.75
    assert "Unrecognised device" in high["reasons"]


def test_fraud_endpoint_validates_input(client):
    assert client.post("/v1/fraud/score", json={**NORMAL, "hour_of_day": 40}).status_code == 422


def test_categorize():
    assert categorize("Coffee and croissant") == "Food & Dining"
    assert categorize("Uber ride home") == "Transport"
    assert categorize("Netflix subscription") == "Entertainment"
    assert categorize("Rent share", "transfer") == "Bills & Utilities"
    assert categorize("for you", "transfer") == "Transfers"
    assert categorize("zzz") == "Other"
    assert categorize("Groceries", "qr_payment", "Corner Cafe") == "Groceries"
    assert categorize("ORDER-42", "qr_payment", "Corner Cafe") == "Food & Dining"


def test_forecast_follows_trend():
    assert forecast_next([100, 200, 300, 400]) > 300
    assert forecast_next([]) == 0
    assert forecast_next([50]) == 50


def _ctx(now):
    def d(days):
        return (now - timedelta(days=days)).isoformat()
    return {
        "currency": "USD",
        "balance": 1234.5,
        "transactions": [
            {"date": d(1), "kind": "qr_payment", "direction": "out", "amount": 120, "description": "Groceries", "counterparty": "Mart"},
            {"date": d(2), "kind": "qr_payment", "direction": "out", "amount": 30, "description": "Coffee", "counterparty": "Corner Cafe"},
            {"date": d(3), "kind": "deposit", "direction": "in", "amount": 500, "description": "Top-up", "counterparty": "Card top-up"},
            {"date": d(40), "kind": "qr_payment", "direction": "out", "amount": 60, "description": "Groceries", "counterparty": "Mart"},
        ],
        "budgets": [{"category": "Groceries", "monthly_limit": 100, "currency": "USD"}],
    }


def test_analyze_builds_categories_budgets_and_tips():
    now = datetime(2026, 11, 20, tzinfo=timezone.utc)
    s = analyze(_ctx(now), now)
    assert s["thisMonth"]["spent"] == 150
    assert s["categories"][0] == {"category": "Groceries", "amount": 120, "previousMonth": 60}
    assert s["budgets"][0]["status"] == "over"
    assert any("Groceries budget" in t for t in s["tips"])


def test_insights_endpoint(client):
    res = client.post("/v1/insights/analyze", json=_ctx(datetime.now(timezone.utc)))
    assert res.status_code == 200
    assert res.json()["transactionsAnalyzed"] == 3


def test_assistant_offline_answers(client):
    ctx = _ctx(datetime.now(timezone.utc))
    r = client.post("/v1/assistant/chat", json={"message": "Where does my money go?", "context": ctx}).json()
    assert r["source"] == "built-in"
    assert "Groceries" in r["reply"]
    r = client.post("/v1/assistant/chat", json={"message": "What's my balance?", "context": ctx}).json()
    assert "1,234.50 USD" in r["reply"]


class _FakeBlock:
    def __init__(self, text):
        self.type = "text"
        self.text = text


class _FakeResponse:
    def __init__(self, stop_reason="end_turn", text="You spent most on groceries."):
        self.stop_reason = stop_reason
        self.content = [_FakeBlock(text)]
        self.model = assistant.MODEL


def test_assistant_uses_llm_when_configured(monkeypatch):
    calls = {}

    class FakeMessages:
        def create(self, **kwargs):
            calls.update(kwargs)
            return _FakeResponse()

    class FakeClient:
        class beta:
            messages = FakeMessages()

    monkeypatch.setenv("ASSISTANT_API_KEY", "test")
    monkeypatch.setattr(assistant, "client", lambda: FakeClient())
    out = assistant.chat("Where does my money go?", [{"role": "assistant", "content": "Hi!"}], _ctx(datetime.now(timezone.utc)))
    assert out == {"reply": "You spent most on groceries.", "source": "llm", "model": assistant.MODEL}
    assert calls["model"] == assistant.MODEL
    assert calls["messages"][0]["role"] == "user"  # leading assistant turn dropped
    assert "<account_snapshot>" in calls["messages"][-1]["content"]
    assert calls["fallbacks"] == "default"


def test_assistant_handles_refusal(monkeypatch):
    class FakeMessages:
        def create(self, **kwargs):
            return _FakeResponse(stop_reason="refusal", text="")

    class FakeClient:
        class beta:
            messages = FakeMessages()

    monkeypatch.setenv("ASSISTANT_API_KEY", "test")
    monkeypatch.setattr(assistant, "client", lambda: FakeClient())
    out = assistant.chat("hello", [], _ctx(datetime.now(timezone.utc)))
    assert "can't help" in out["reply"]


def test_health(client):
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["fraudModel"]["metrics"]["roc_auc"] > 0.8


FIRST_PAYMENT = {
    "amount_usd": 350, "account_age_days": 200, "tx_count_1h": 0, "tx_count_24h": 0, "amount_sum_24h_usd": 0,
    "avg_amount_90d_usd": 0, "is_new_recipient": 1, "is_known_device": 0, "kyc_level": 1, "hour_of_day": 16,
}


def test_first_payment_from_established_account_is_not_high_risk(client):
    """Regression: customers with no payment history were scored as near-certain fraud."""
    low = client.post("/v1/fraud/score", json=FIRST_PAYMENT).json()
    assert low["score"] < 0.5
    bigger = client.post("/v1/fraud/score", json={**FIRST_PAYMENT, "amount_usd": 1200}).json()
    assert bigger["score"] < 0.75


def test_several_normal_payments_in_an_hour_are_not_risky(client):
    """Regression: a small payment after a few others in the same hour triggered an MFA challenge."""
    busy = {"amount_usd": 18.5, "account_age_days": 200, "tx_count_1h": 3, "tx_count_24h": 3, "amount_sum_24h_usd": 1850,
            "avg_amount_90d_usd": 616, "is_new_recipient": 0, "is_known_device": 0, "kyc_level": 1, "hour_of_day": 16}
    assert client.post("/v1/fraud/score", json=busy).json()["score"] < 0.5
