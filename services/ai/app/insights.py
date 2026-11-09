"""Spending analytics: categorisation, monthly trends, forecasting, budgets and tips."""

from __future__ import annotations

import re
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import numpy as np

CATEGORY_KEYWORDS: dict[str, list[str]] = {
    "Food & Dining": ["coffee", "cafe", "café", "restaurant", "lunch", "dinner", "breakfast", "pizza", "burger", "food", "croissant", "kfc", "mcdonald", "starbucks", "bakery"],
    "Groceries": ["grocery", "groceries", "supermarket", "mart", "carrefour", "walmart", "aldi", "tesco", "imtiaz"],
    "Transport": ["uber", "careem", "lyft", "taxi", "bus", "metro", "train", "fuel", "petrol", "parking", "ride"],
    "Shopping": ["amazon", "daraz", "store", "shop", "clothes", "shoes", "mall", "electronics"],
    "Bills & Utilities": ["electric", "electricity", "water", "gas bill", "internet", "phone bill", "mobile", "utility", "bill", "rent"],
    "Entertainment": ["netflix", "spotify", "movie", "cinema", "concert", "game", "tickets", "youtube", "disney"],
    "Health": ["pharmacy", "doctor", "hospital", "clinic", "medicine", "gym", "dental"],
    "Travel": ["hotel", "flight", "airline", "airbnb", "booking", "travel"],
    "Education": ["book", "course", "tuition", "school", "university", "udemy", "coursera"],
}

CATEGORIES = [*CATEGORY_KEYWORDS.keys(), "Transfers", "Other"]


def categorize(description: str, kind: str = "", counterparty: str = "") -> str:
    # The payment description is the strongest signal; fall back to the counterparty's name.
    for text in (description.lower(), counterparty.lower()):
        for category, words in CATEGORY_KEYWORDS.items():
            if any(re.search(rf"\b{re.escape(w)}", text) for w in words):
                return category
    if kind == "transfer":
        return "Transfers"
    return "Other"


def _month(iso: str) -> str:
    return iso[:7]


def _parse(iso: str) -> datetime:
    return datetime.fromisoformat(iso.replace("Z", "+00:00"))


def forecast_next(values: list[float]) -> float:
    """Weighted linear trend over the last months, never negative, damped toward the mean."""
    if not values:
        return 0.0
    if len(values) < 3:
        return float(np.mean(values))
    y = np.array(values[-6:], dtype=float)
    x = np.arange(len(y))
    slope, intercept = np.polyfit(x, y, 1, w=np.linspace(0.5, 1.0, len(y)))
    trend = slope * len(y) + intercept
    return float(max(0.0, 0.6 * trend + 0.4 * y.mean()))


def analyze(ctx: dict, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    this_month = now.strftime("%Y-%m")
    prev = (now.replace(day=1) - timedelta(days=1)).strftime("%Y-%m")

    spending: list[dict] = []
    income_by_month: dict[str, float] = defaultdict(float)
    for t in ctx.get("transactions", []):
        if t["kind"] in ("fx",):
            continue
        if t["direction"] == "in":
            if t["kind"] not in ("hold_reversal",):
                income_by_month[_month(t["date"])] += t["amount"]
            continue
        if t["kind"] == "withdrawal":
            continue
        spending.append({**t, "category": categorize(t.get("description", ""), t["kind"], t.get("counterparty", ""))})

    by_month: dict[str, float] = defaultdict(float)
    by_cat_month: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    merchants: dict[str, float] = defaultdict(float)
    for s in spending:
        m = _month(s["date"])
        by_month[m] += s["amount"]
        by_cat_month[m][s["category"]] += s["amount"]
        if s.get("counterparty"):
            merchants[s["counterparty"]] += s["amount"]

    months = sorted(set(by_month) | set(income_by_month))[-6:]
    monthly = [{"month": m, "spent": round(by_month.get(m, 0.0), 2), "received": round(income_by_month.get(m, 0.0), 2)} for m in months]
    current = by_cat_month.get(this_month, {})
    previous = by_cat_month.get(prev, {})
    categories = sorted(
        [
            {"category": c, "amount": round(v, 2), "previousMonth": round(previous.get(c, 0.0), 2)}
            for c, v in current.items()
        ],
        key=lambda r: -r["amount"],
    )

    complete_months = [by_month.get(m, 0.0) for m in months if m != this_month]
    forecast = forecast_next(complete_months) if complete_months else by_month.get(this_month, 0.0)

    # Pace the current month: projected = spent so far / fraction of month elapsed.
    days_in_month = 31 if now.month in (1, 3, 5, 7, 8, 10, 12) else 30 if now.month != 2 else 28
    elapsed = max(now.day / days_in_month, 0.1)

    budgets = []
    for b in ctx.get("budgets", []):
        if b.get("currency") and b["currency"] != ctx.get("currency"):
            continue
        spent = current.get(b["category"], 0.0)
        projected = spent / elapsed
        status = "over" if spent > b["monthly_limit"] else "at_risk" if projected > b["monthly_limit"] else "on_track"
        budgets.append({
            "category": b["category"],
            "limit": b["monthly_limit"],
            "spent": round(spent, 2),
            "projected": round(projected, 2),
            "percentUsed": round(100 * spent / b["monthly_limit"], 1) if b["monthly_limit"] else 0,
            "status": status,
        })

    tips = build_tips(ctx, categories, budgets, by_month.get(this_month, 0.0), by_month.get(prev, 0.0), income_by_month.get(prev, 0.0), merchants)

    return {
        "currency": ctx.get("currency", "USD"),
        "balance": ctx.get("balance", 0),
        "thisMonth": {"spent": round(by_month.get(this_month, 0.0), 2), "received": round(income_by_month.get(this_month, 0.0), 2)},
        "lastMonth": {"spent": round(by_month.get(prev, 0.0), 2), "received": round(income_by_month.get(prev, 0.0), 2)},
        "forecastNextMonth": round(forecast, 2),
        "monthly": monthly,
        "categories": categories,
        "topMerchants": [{"name": k, "amount": round(v, 2)} for k, v in sorted(merchants.items(), key=lambda kv: -kv[1])[:5]],
        "budgets": budgets,
        "tips": tips,
        "transactionsAnalyzed": len(spending),
    }


def build_tips(ctx, categories, budgets, spent_now, spent_prev, income_prev, merchants) -> list[str]:
    cur = ctx.get("currency", "USD")
    tips: list[str] = []
    for b in budgets:
        if b["status"] == "over":
            tips.append(f"You're over your {b['category']} budget ({b['spent']:.2f} of {b['limit']:.2f} {cur}). Consider pausing non-essential spending there.")
        elif b["status"] == "at_risk":
            tips.append(f"At this pace you'll spend about {b['projected']:.2f} {cur} on {b['category']}, above your {b['limit']:.2f} budget.")
    for c in categories[:3]:
        if c["previousMonth"] > 0 and c["amount"] > 1.3 * c["previousMonth"] and c["amount"] - c["previousMonth"] > 20:
            pct = 100 * (c["amount"] / c["previousMonth"] - 1)
            tips.append(f"{c['category']} spending is up {pct:.0f}% on last month.")
    subs = [m for m in merchants if re.search(r"netflix|spotify|youtube|disney|subscription", m, re.I)]
    if subs:
        tips.append("Review your subscriptions; small recurring charges add up over a year.")
    if income_prev > 0 and spent_prev > 0:
        rate = 1 - spent_prev / income_prev
        if rate < 0.1:
            tips.append("Last month you saved under 10% of what came in. Try moving 10% of each top-up into a separate wallet.")
        else:
            tips.append(f"Nice work: you kept {rate * 100:.0f}% of last month's income.")
    if not budgets and categories:
        tips.append(f"Set a monthly budget for {categories[0]['category']}, your biggest category, to track it automatically.")
    if not tips:
        tips.append("Your spending looks steady. Keep an emergency fund of 3 to 6 months of expenses.")
    return tips[:5]
