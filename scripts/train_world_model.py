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
    p.add_argument("--epochs", type=int, default=50)
    p.add_argument("--batch-size", type=int, default=32)
    p.add_argument("--lr", type=float, default=3e-4)
    p.add_argument("--hidden-dim", type=int, default=128)
    p.add_argument("--latent-dim", type=int, default=128)
    p.add_argument("--dropout", type=float, default=0.1)
    p.add_argument("--multi-step", type=int, default=2, help="多步损失步数（>=1）")
    p.add_argument("--multi-step-weight", type=float, default=0.5)
    p.add_argument("--device", default="auto", help="auto|cpu|mps|cuda")
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--num-workers", type=int, default=0, help="DataLoader worker 数")
    p.add_argument("--pin-memory", action="store_true", help="DataLoader pin_memory（CUDA 通常开启）")
    p.add_argument("--deterministic", action="store_true", help="cudnn deterministic / deterministic algorithms")
    p.add_argument("--patience", type=int, default=10, help="early stopping patience")
    p.add_argument("--model-version", default="hcc-wm-mvp-0.2-residual")
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
        dropout=args.dropout,
        multi_step=args.multi_step,
        multi_step_weight=args.multi_step_weight,
        device_name=args.device,
        seed=args.seed,
        patience=args.patience,
        num_workers=args.num_workers,
        pin_memory=True if args.pin_memory else None,
        deterministic=args.deterministic,
        model_version=args.model_version,
        run_eval=not args.no_eval,
    )
    print("done:", meta["checkpoint"], "best_val=", meta["best_val"], "best_epoch=", meta.get("best_epoch"))


if __name__ == "__main__":
    main()
