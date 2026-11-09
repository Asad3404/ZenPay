"""SecurePay AI service: fraud scoring, spending insights and the financial assistant.

Internal service: it is called only by the core API and should not be exposed to the internet.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from . import assistant
from .fraud import FEATURES, FraudModel, explain
from .insights import CATEGORIES, analyze, categorize

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

state: dict = {}


@asynccontextmanager
async def lifespan(_: FastAPI):
    state["fraud"] = FraudModel.load_or_train()
    yield


app = FastAPI(title="SecurePay AI Service", version="1.0.0", lifespan=lifespan)


class FraudFeatures(BaseModel):
    amount_usd: float = Field(ge=0)
    account_age_days: float = Field(ge=0)
    tx_count_1h: int = Field(ge=0)
    tx_count_24h: int = Field(ge=0)
    amount_sum_24h_usd: float = Field(ge=0)
    avg_amount_90d_usd: float = Field(ge=0)
    is_new_recipient: int = Field(ge=0, le=1)
    is_known_device: int = Field(ge=0, le=1)
    kyc_level: int = Field(ge=0, le=2)
    hour_of_day: int = Field(ge=0, le=23)


class Transaction(BaseModel):
    date: str
    kind: str
    direction: Literal["in", "out"]
    amount: float = Field(ge=0)
    description: str = ""
    counterparty: str = ""


class Budget(BaseModel):
    category: str
    monthly_limit: float = Field(gt=0)
    currency: str | None = None


class InsightsContext(BaseModel):
    first_name: str | None = None
    currency: str = "USD"
    balance: float = 0
    transactions: list[Transaction] = Field(default_factory=list, max_length=1000)
    budgets: list[Budget] = Field(default_factory=list, max_length=50)


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=4000)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=1000)
    history: list[ChatTurn] = Field(default_factory=list, max_length=20)
    context: InsightsContext


class CategorizeRequest(BaseModel):
    description: str
    kind: str = ""
    counterparty: str = ""


@app.get("/health")
def health():
    model: FraudModel | None = state.get("fraud")
    return {
        "status": "ok",
        "fraudModel": {"version": model.version, "metrics": model.metrics} if model else None,
        "assistant": "llm" if assistant.has_llm_credentials() else "built-in",
    }


@app.post("/v1/fraud/score")
def fraud_score(features: FraudFeatures):
    model: FraudModel = state["fraud"]
    f = features.model_dump()
    score, probability, anomaly = model.score(f)
    return {
        "score": score,
        "probability": probability,
        "anomaly": anomaly,
        "reasons": explain(f) if score >= 0.3 else [],
        "modelVersion": model.version,
        "features": FEATURES,
    }


@app.post("/v1/insights/analyze")
def insights(ctx: InsightsContext):
    return analyze(ctx.model_dump())


@app.post("/v1/categorize")
def categorize_one(req: CategorizeRequest):
    return {"category": categorize(req.description, req.kind, req.counterparty), "categories": CATEGORIES}


@app.post("/v1/assistant/chat")
async def chat(req: ChatRequest):
    # The model client is synchronous; run it off the event loop.
    return await run_in_threadpool(
        assistant.chat, req.message, [t.model_dump() for t in req.history], req.context.model_dump()
    )
