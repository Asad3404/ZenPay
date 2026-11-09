"""Fraud risk model.

Two models are combined:
  * HistGradientBoostingClassifier - supervised, learns known fraud patterns.
  * IsolationForest - unsupervised, trained on legitimate traffic only, flags unusual behaviour.

There is no public labelled dataset with SecurePay's exact features, so the model is bootstrapped on a
synthetic dataset that encodes well-known fraud typologies (account takeover, mule accounts, velocity
attacks). Retrain on real labelled outcomes from the admin review queue once you have them:
    python -m scripts.train_fraud_model --data your_labelled.csv
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

import joblib
import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier, IsolationForest
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.model_selection import train_test_split

log = logging.getLogger("securepay.fraud")

FEATURES = [
    "amount_usd",
    "account_age_days",
    "tx_count_1h",
    "tx_count_24h",
    "amount_sum_24h_usd",
    "avg_amount_90d_usd",
    "is_new_recipient",
    "is_known_device",
    "kyc_level",
    "hour_of_day",
]

MODEL_PATH = Path(__file__).resolve().parent.parent / "models" / "fraud_model.joblib"
MODEL_VERSION = "1.2.0"


def synthetic_dataset(n: int = 40_000, fraud_rate: float = 0.04, seed: int = 7) -> tuple[np.ndarray, np.ndarray]:
    """Generates labelled transactions. Legitimate users have stable habits; fraud follows known typologies."""
    rng = np.random.default_rng(seed)
    n_fraud = int(n * fraud_rate)
    n_legit = n - n_fraud

    # Legitimate behaviour
    avg = rng.lognormal(mean=3.4, sigma=0.9, size=n_legit)  # typical ~30 USD
    legit = np.column_stack(
        [
            np.clip(avg * rng.lognormal(0, 0.6, n_legit), 1, 20_000),
            rng.gamma(2.0, 180, n_legit),
            rng.poisson(0.3, n_legit),
            rng.poisson(2.0, n_legit),
            avg * rng.gamma(2.0, 1.0, n_legit),
            avg,
            rng.binomial(1, 0.25, n_legit),
            rng.binomial(1, 0.8, n_legit),
            rng.choice([0, 1, 2], n_legit, p=[0.25, 0.6, 0.15]),
            np.clip(rng.normal(14, 4, n_legit), 0, 23).round(),
        ]
    )
    # Busy but genuine customers (shopping trips, splitting bills): several payments within an hour.
    busy = (rng.random(n_legit) < 0.12) & (legit[:, 5] > 0)
    b = int(busy.sum())
    legit[busy, 2] = rng.poisson(2.5, b)
    legit[busy, 3] = legit[busy, 2] + rng.poisson(3, b)
    legit[busy, 4] = legit[busy, 5] * np.maximum(legit[busy, 3], 1) * rng.uniform(0.5, 1.5, b)
    # Genuine customers making their first payments: no spending history yet, often a new
    # recipient and a fresh browser. Without these rows the model treats "no history" as fraud.
    first = rng.random(n_legit) < 0.15
    k = int(first.sum())
    legit[first, 0] = np.clip(rng.lognormal(4.3, 1.0, k), 5, 5000)
    legit[first, 2] = 0
    legit[first, 3] = rng.poisson(0.3, k)
    legit[first, 4] = legit[first, 0]
    legit[first, 5] = 0
    legit[first, 6] = rng.binomial(1, 0.9, k)
    legit[first, 7] = rng.binomial(1, 0.5, k)

    # Fraud typologies
    kinds = rng.choice(["takeover", "mule", "velocity"], n_fraud, p=[0.5, 0.25, 0.25])
    rows = []
    for k in kinds:
        avg_f = rng.lognormal(3.4, 0.9)
        if k == "takeover":  # established account, new device, big payout to a new recipient, odd hours
            amount = avg_f * rng.uniform(8, 60)
            rows.append([amount, rng.gamma(2.0, 200), rng.poisson(1.5), rng.poisson(4), amount * rng.uniform(1, 2.5), avg_f,
                         rng.binomial(1, 0.95), rng.binomial(1, 0.15), rng.choice([1, 2]), rng.choice([1, 2, 3, 4, 22, 23])])
        elif k == "mule":  # brand-new account that moves money out quickly
            amount = rng.uniform(300, 5000)
            rows.append([amount, rng.uniform(0, 3), rng.poisson(2), rng.poisson(6), amount * rng.uniform(1.5, 4), rng.uniform(0, 50),
                         rng.binomial(1, 0.9), rng.binomial(1, 0.5), rng.choice([0, 1], p=[0.6, 0.4]), rng.integers(0, 24)])
        else:  # velocity / card testing
            amount = rng.uniform(1, 60)
            rows.append([amount, rng.gamma(1.5, 60), rng.poisson(9) + 4, rng.poisson(25) + 10, amount * rng.uniform(15, 40), avg_f,
                         rng.binomial(1, 0.8), rng.binomial(1, 0.4), rng.choice([0, 1]), rng.integers(0, 24)])
    fraud = np.array(rows)

    X = np.vstack([legit, fraud]).astype(float)
    y = np.concatenate([np.zeros(n_legit), np.ones(n_fraud)])
    # Real labels are noisy (missed fraud, false chargebacks). Flip a small share so the
    # model and its reported metrics don't look unrealistically perfect.
    noise = rng.random(len(y)) < 0.015
    y[noise] = 1 - y[noise]
    idx = rng.permutation(len(y))
    return X[idx], y[idx]


def _engineer(X: np.ndarray) -> np.ndarray:
    """Adds ratio features that make spending spikes scale-free."""
    amount, avg = X[:, 0], X[:, 5]
    has_history = (avg > 0).astype(float)
    # With no history there is no baseline to compare against, so the spike ratio is neutral.
    ratio = np.where(avg > 0, amount / np.maximum(avg, 1.0), 1.0)
    log_amount = np.log1p(amount)
    night = ((X[:, 9] >= 0) & (X[:, 9] <= 5)).astype(float)
    return np.column_stack([X, ratio, log_amount, night, has_history])


@dataclass
class FraudModel:
    classifier: HistGradientBoostingClassifier
    isolation: IsolationForest
    iso_offset: float
    iso_scale: float
    metrics: dict
    version: str = MODEL_VERSION

    @classmethod
    def train(cls, X: np.ndarray, y: np.ndarray, seed: int = 7) -> "FraudModel":
        Xe = _engineer(X)
        X_train, X_test, y_train, y_test = train_test_split(Xe, y, test_size=0.2, stratify=y, random_state=seed)
        clf = HistGradientBoostingClassifier(max_iter=250, learning_rate=0.08, max_leaf_nodes=31, class_weight="balanced", random_state=seed)
        clf.fit(X_train, y_train)
        iso = IsolationForest(n_estimators=200, contamination=0.02, random_state=seed)
        iso.fit(X_train[y_train == 0])
        raw = -iso.score_samples(X_train[y_train == 0])
        proba = clf.predict_proba(X_test)[:, 1]
        metrics = {
            "roc_auc": round(float(roc_auc_score(y_test, proba)), 4),
            "average_precision": round(float(average_precision_score(y_test, proba)), 4),
            "test_size": int(len(y_test)),
            "fraud_rate": round(float(y.mean()), 4),
        }
        log.info("trained fraud model %s", metrics)
        return cls(clf, iso, float(np.percentile(raw, 50)), float(np.std(raw) or 1.0), metrics)

    def score(self, features: dict) -> tuple[float, float, float]:
        x = np.array([[float(features[f]) for f in FEATURES]])
        xe = _engineer(x)
        p = float(self.classifier.predict_proba(xe)[0, 1])
        raw = float(-self.isolation.score_samples(xe)[0])
        anomaly = float(1 / (1 + np.exp(-(raw - self.iso_offset) / (self.iso_scale / 2))))
        # Supervised probability dominates; anomaly only nudges unseen patterns upward.
        combined = min(1.0, 0.85 * p + 0.15 * max(0.0, anomaly - 0.5) * 2)
        return round(combined, 4), round(p, 4), round(anomaly, 4)

    def save(self, path: Path = MODEL_PATH) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(self, path)

    @classmethod
    def load_or_train(cls, path: Path = MODEL_PATH) -> "FraudModel":
        if path.exists():
            try:
                model = joblib.load(path)
                if getattr(model, "version", None) == MODEL_VERSION:
                    return model
            except Exception as exc:  # corrupt or incompatible pickle
                log.warning("could not load %s (%s); retraining", path, exc)
        model = cls.train(*synthetic_dataset())
        try:
            model.save(path)
        except OSError:
            log.warning("model directory not writable; keeping model in memory only")
        return model


def explain(features: dict) -> list[str]:
    """Human-readable reasons shown to analysts and, in softened form, to customers."""
    reasons = []
    amount, avg = features["amount_usd"], features["avg_amount_90d_usd"]
    if avg > 0 and amount / avg >= 5 and amount >= 100:
        reasons.append(f"Amount is {amount / avg:.0f}x the 90-day average")
    if features["tx_count_1h"] >= 4:
        reasons.append(f"{int(features['tx_count_1h'])} payments in the last hour")
    if features["account_age_days"] < 3:
        reasons.append("Account is less than 3 days old")
    if features["is_new_recipient"] and amount >= 300:
        reasons.append("First payment to this recipient")
    if not features["is_known_device"]:
        reasons.append("Unrecognised device")
    if 0 <= features["hour_of_day"] <= 5:
        reasons.append("Unusual time of day")
    return reasons or ["Pattern differs from typical account behaviour"]
