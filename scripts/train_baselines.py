"""CLI：训练 GRU 基线，并与 Persistence / World Model 对比摘要。

示例：
  PYTHONPATH=. python scripts/train_baselines.py \\
    --data artifacts/synthetic --max-patients 300 --out artifacts/models/baselines
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch
from torch.utils.data import DataLoader, Subset

from packages.data.dataset import TrajectoryDataset, collate_trajectories
from packages.training.baselines import train_gru_baseline
from packages.training.evaluate import evaluate_persistence, one_step_feature_metrics
from packages.training.train import fit_normalizer_on_indices, resolve_device, split_indices


def main() -> None:
    p = argparse.ArgumentParser(description="Train GRU forecasting baseline")
    p.add_argument("--data", default="artifacts/synthetic")
    p.add_argument("--out", default="artifacts/models/baselines")
    p.add_argument("--max-patients", type=int, default=300)
    p.add_argument("--max-visits", type=int, default=12)
    p.add_argument("--epochs", type=int, default=20)
    p.add_argument("--batch-size", type=int, default=32)
    p.add_argument("--device", default="auto")
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--patience", type=int, default=5)
    args = p.parse_args()

    device = resolve_device(args.device)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    ds = TrajectoryDataset(args.data, max_patients=args.max_patients, max_visits=args.max_visits)
    train_idx, val_idx, test_idx = split_indices(len(ds), seed=args.seed)
    ds.normalizer = fit_normalizer_on_indices(ds, train_idx)

    def loader(indices, shuffle):
        return DataLoader(
            Subset(ds, indices),
            batch_size=args.batch_size,
            shuffle=shuffle,
            collate_fn=collate_trajectories,
        )

    train_loader = loader(train_idx, True)
    val_loader = loader(val_idx, False) if val_idx else None
    test_loader = loader(test_idx, False)

    model, history = train_gru_baseline(
        train_loader,
        val_loader,
        ds.apply_normalizer_to_batch,
        device=device,
        epochs=args.epochs,
        patience=args.patience,
    )

    # test：归一化空间预测再逆变换
    preds, targets, valids = [], [], []
    model.eval()
    with torch.no_grad():
        for batch in test_loader:
            batch_t = {
                k: (v.to(device) if torch.is_tensor(v) else v) for k, v in batch.items()
            }
            raw = batch_t["features"]
            batch_n = ds.apply_normalizer_to_batch(dict(batch_t))
            out = model(batch_n)
            pred = ds.normalizer.inverse_transform(out["pred_features"])
            target = raw[:, 1:, :]
            miss_next = batch_t["missing"][:, 1:, :]
            step_valid = batch_t["pad_mask"][:, 1:] & batch_t["pad_mask"][:, :-1]
            valid = step_valid.unsqueeze(-1) & (~miss_next)
            preds.append(pred.cpu())
            targets.append(target.cpu())
            valids.append(valid.cpu())

    gru_metrics = one_step_feature_metrics(
        torch.cat(preds, 0), torch.cat(targets, 0), torch.cat(valids, 0)
    )
    pers_metrics = evaluate_persistence(test_loader)

    ckpt_path = out_dir / "gru_baseline.pt"
    torch.save(
        {
            "model": model.state_dict(),
            "normalizer": ds.normalizer.state_dict(),
            "config": {
                "hidden_dim": 64,
                "max_patients": args.max_patients,
                "seed": args.seed,
                "research_only": True,
                "model_version": "gru-baseline-0.1",
            },
            "train_idx": train_idx,
            "val_idx": val_idx,
            "test_idx": test_idx,
        },
        ckpt_path,
    )

    report = {
        "research_only": True,
        "data_source": "synthetic",
        "gru_baseline": gru_metrics,
        "persistence": pers_metrics,
        "beats_persistence_mae": gru_metrics["mae_mean"] < pers_metrics["mae_mean"],
        "history": history,
        "checkpoint": str(ckpt_path),
    }
    report_path = out_dir / "baseline_report.json"
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({
        "gru_mae": gru_metrics["mae_mean"],
        "persistence_mae": pers_metrics["mae_mean"],
        "beats_persistence_mae": report["beats_persistence_mae"],
        "checkpoint": str(ckpt_path),
    }, indent=2))


if __name__ == "__main__":
    main()
