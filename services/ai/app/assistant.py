"""AI financial assistant.

Uses a hosted large language model when ASSISTANT_API_KEY is set; otherwise answers common questions from the computed insights so the feature still works offline.

Safety design: the assistant only receives aggregated, de-identified data (no account numbers, emails
or ids) and has no tools that move money. It can explain and suggest; the user acts in the app.
"""

from __future__ import annotations

import json
import logging
import os
import re

import anthropic

from .insights import analyze

log = logging.getLogger("securepay.assistant")

MODEL = os.getenv("ASSISTANT_MODEL", "claude-opus-5-5")

SYSTEM_PROMPT = """You are the in-app financial guide for SecurePay, a digital wallet.

You help one customer understand their own money: where it goes, how to budget, how to save, and how SecurePay features work (sending money, QR payments, multi-currency wallets and conversion, two-factor authentication, identity verification limits).

You receive a JSON snapshot of the customer's recent activity, computed by SecurePay. Ground every number you mention in that snapshot; if the data doesn't answer the question, say so plainly. Amounts are in the customer's base currency unless stated.

Keep answers short and practical: a direct answer first, then at most three concrete suggestions. Use plain language a non-expert understands. You can't move money, change settings or see anything outside the snapshot; tell the customer which screen in the app to use instead.

Give general guidance, not regulated investment, tax or legal advice; for those, suggest a qualified professional. Never ask for passwords, MFA codes, card numbers or ID numbers. If the customer mentions a payment they don't recognise or thinks someone else is using their account, tell them to freeze their account from Settings > Security and contact support right away."""


def has_llm_credentials() -> bool:
    return bool(os.getenv("ASSISTANT_API_KEY"))


_client: anthropic.Anthropic | None = None


def client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic(api_key=os.getenv("ASSISTANT_API_KEY"), timeout=90.0, max_retries=2)
    return _client


def build_snapshot(context: dict) -> dict:
    """Compact summary sent to the model instead of raw transactions."""
    summary = analyze(context)
    recent = [
        {k: t[k] for k in ("date", "direction", "amount", "description", "counterparty") if k in t}
        for t in context.get("transactions", [])[:25]
    ]
    return {"customer_first_name": context.get("first_name"), **summary, "recent_transactions": recent}


def chat_with_llm(message: str, history: list[dict], context: dict) -> dict:
    snapshot = build_snapshot(context)
    messages = [{"role": h["role"], "content": h["content"]} for h in history if h.get("content")]
    # Conversation must start with a user turn.
    while messages and messages[0]["role"] != "user":
        messages.pop(0)
    messages.append(
        {
            "role": "user",
            "content": f"<account_snapshot>\n{json.dumps(snapshot, default=str)}\n</account_snapshot>\n\n{message}",
        }
    )
    try:
        response = client().beta.messages.create(
            model=MODEL,
            max_tokens=16000,
            system=SYSTEM_PROMPT,
            messages=messages,
            output_config={"effort": "low"},
            # Server-side fallback: if the model declines, the API retries on the provider's recommended model.
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
    except anthropic.RateLimitError:
        log.warning("Language model rate limited; using offline answer")
        return {**offline_answer(message, context), "notice": "The AI assistant is busy, so this is a quick built-in answer."}
    except anthropic.APIStatusError as exc:
        log.error("Language model API error %s (request %s)", exc.status_code, getattr(exc, "request_id", None))
        return {**offline_answer(message, context), "notice": "The AI assistant is unavailable, so this is a quick built-in answer."}
    except anthropic.APIConnectionError:
        log.error("Could not reach the language model API")
        return {**offline_answer(message, context), "notice": "The AI assistant is unavailable, so this is a quick built-in answer."}

    if response.stop_reason == "refusal":
        return {"reply": "I can't help with that one. I can help with budgeting, spending and using SecurePay.", "source": "llm", "model": response.model}
    text = "".join(block.text for block in response.content if block.type == "text").strip()
    return {"reply": text or "Sorry, I couldn't come up with an answer. Try rephrasing.", "source": "llm", "model": response.model}


def offline_answer(message: str, context: dict) -> dict:
    """Rule-based answers for the most common questions, from the same computed insights."""
    s = analyze(context)
    cur = s["currency"]
    q = message.lower()

    def money(x: float) -> str:
        return f"{x:,.2f} {cur}"

    if re.search(r"balance|how much (do i|money) have", q):
        reply = f"Your total balance across wallets is about {money(s['balance'])}."
    elif re.search(r"categor|where.*(money|spend)|spend.*most|breakdown", q):
        if s["categories"]:
            top = ", ".join(f"{c['category']} {money(c['amount'])}" for c in s["categories"][:4])
            reply = f"This month you've spent {money(s['thisMonth']['spent'])}. Biggest categories: {top}."
        else:
            reply = "You haven't spent anything yet this month."
    elif re.search(r"forecast|next month|predict|expect", q):
        reply = f"Based on your recent months, expect to spend about {money(s['forecastNextMonth'])} next month."
    elif re.search(r"budget", q):
        if s["budgets"]:
            parts = [f"{b['category']}: {money(b['spent'])} of {money(b['limit'])} ({b['status'].replace('_', ' ')})" for b in s["budgets"]]
            reply = "Your budgets this month: " + "; ".join(parts) + "."
        else:
            reply = "You don't have any budgets yet. Open Insights > Budgets to set a monthly limit for a category."
    elif re.search(r"save|saving|tip|advice|improve", q):
        reply = " ".join(s["tips"][:3])
    elif re.search(r"last month|compare", q):
        reply = f"Last month you spent {money(s['lastMonth']['spent'])} and received {money(s['lastMonth']['received'])}. So far this month: {money(s['thisMonth']['spent'])} spent."
    elif re.search(r"fraud|scam|stolen|hack|don.t recogni", q):
        reply = "If you see a payment you don't recognise, freeze your account from Settings > Security and contact support right away. Turning on two-factor authentication also protects your wallet."
    else:
        reply = (
            f"This month you've spent {money(s['thisMonth']['spent'])} and received {money(s['thisMonth']['received'])}. "
            "Ask me about your spending by category, budgets, a forecast for next month, or tips to save."
        )
    return {"reply": reply, "source": "built-in"}


def chat(message: str, history: list[dict], context: dict) -> dict:
    if has_llm_credentials():
        return chat_with_llm(message, history, context)
    return offline_answer(message, context)
