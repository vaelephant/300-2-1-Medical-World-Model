"""CLI：训练 HCC 世界模型 MVP。

示例（小队列快速出权重）：
  PYTHONPATH=. python scripts/train_world_model.py \\
    --data artifacts/synthetic --max-patients 300 --epochs 15 --out artifacts/models/mvp
"""

from __future__ import annotations

import argparse

from packages.training.train import train_world_model


def main() -> None:
    p = argparse.ArgumentParser(description="Train HCC world model MVP")
    p.add_argument("--data", default="artifacts/synthetic")
    p.add_argument("--out", default="artifacts/models/mvp")
    p.add_argument("--max-patients", type=int, default=300)
    p.add_argument("--max-visits", type=int, default=12)
    p.add_argument("--epochs", type=int, default=15)
    p.add_argument("--batch-size", type=int, default=32)
    p.add_argument("--lr", type=float, default=3e-4)
    p.add_argument("--hidden-dim", type=int, default=128)
    p.add_argument("--latent-dim", type=int, default=128)
    p.add_argument("--device", default="auto", help="auto|cpu|mps|cuda")
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--patience", type=int, default=10, help="early stopping patience")
    p.add_argument("--no-eval", action="store_true", help="训练结束不跑 test 评估")
    args = p.parse_args()

    meta = train_world_model(
        data_dir=args.data,
        out_dir=args.out,
        max_patients=args.max_patients,
        max_visits=args.max_visits,
        epochs=args.epochs,
        batch_size=args.batch_size,
        lr=args.lr,
        hidden_dim=args.hidden_dim,
        latent_dim=args.latent_dim,
        device_name=args.device,
        seed=args.seed,
        patience=args.patience,
        run_eval=not args.no_eval,
    )
    print("done:", meta["checkpoint"], "best_val=", meta["best_val"])


if __name__ == "__main__":
    main()
