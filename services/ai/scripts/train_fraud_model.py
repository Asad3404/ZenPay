"""Train the fraud model and save it to models/fraud_model.joblib.

Usage:
    python -m scripts.train_fraud_model                  # synthetic bootstrap data
    python -m scripts.train_fraud_model --data labelled.csv

A labelled CSV needs one column per feature in app.fraud.FEATURES plus `is_fraud` (0/1).
Export it from resolved fraud cases (approved = 0, rejected = 1) joined with their features.
"""

import argparse
import csv
import json

import numpy as np

from app.fraud import FEATURES, MODEL_PATH, FraudModel, synthetic_dataset


def load_csv(path: str):
    with open(path, newline="") as fh:
        rows = list(csv.DictReader(fh))
    X = np.array([[float(r[f]) for f in FEATURES] for r in rows])
    y = np.array([int(r["is_fraud"]) for r in rows])
    return X, y


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", help="Labelled CSV; omit to use synthetic data")
    parser.add_argument("--rows", type=int, default=40_000)
    args = parser.parse_args()
    X, y = load_csv(args.data) if args.data else synthetic_dataset(args.rows)
    model = FraudModel.train(X, y)
    model.save(MODEL_PATH)
    print(json.dumps({"saved": str(MODEL_PATH), **model.metrics}, indent=2))


if __name__ == "__main__":
    main()
