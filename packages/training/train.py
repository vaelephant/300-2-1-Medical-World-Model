"""世界模型训练循环（MVP）。

改进点：
- normalizer 只在 train split 上拟合（防泄漏）
- early stopping（patience）
- 训练结束可自动跑 test 评估报告
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional

import torch
from torch.utils.data import DataLoader, Subset

from packages.data.dataset import FeatureNormalizer, TrajectoryDataset, collate_trajectories
from packages.world_model.model import HCCWorldModel


def resolve_device(name: str = "auto") -> torch.device:
    name = name.lower()
    if name == "cpu":
        return torch.device("cpu")
    if name == "mps":
        return torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    if name == "cuda":
        return torch.device("cuda" if torch.cuda.is_available() else "cpu")
    if torch.cuda.is_available():
        return torch.device("cuda")
    if torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def split_indices(n: int, train_ratio: float = 0.7, val_ratio: float = 0.15, seed: int = 42):
    g = torch.Generator().manual_seed(seed)
    perm = torch.randperm(n, generator=g).tolist()
    n_train = int(n * train_ratio)
    n_val = int(n * val_ratio)
    train_idx = perm[:n_train]
    val_idx = perm[n_train : n_train + n_val]
    test_idx = perm[n_train + n_val :]
    return train_idx, val_idx, test_idx


def fit_normalizer_on_indices(ds: TrajectoryDataset, indices: List[int]) -> FeatureNormalizer:
    """仅用指定样本估计 mean/std。"""
    xs: List[torch.Tensor] = []
    for i in indices:
        item = ds[i]
        feat = item["features"]
        miss = item["missing"]
        for t in range(feat.shape[0]):
            if (~miss[t]).any():
                xs.append(feat[t].clone())
    stacked = torch.stack(xs, dim=0)
    tmp = FeatureNormalizer(
        mean=torch.zeros(stacked.shape[-1]),
        std=torch.ones(stacked.shape[-1]),
        log_afp=True,
    )
    logged = tmp._maybe_log(stacked)
    mean = logged.mean(dim=0)
    std = logged.std(dim=0, unbiased=False)
    return FeatureNormalizer(mean=mean, std=std, log_afp=True)


def _run_epoch(
    model: HCCWorldModel,
    loader: DataLoader,
    normalizer_batch_fn,
    optimizer: Optional[torch.optim.Optimizer],
    device: torch.device,
    grad_clip: float = 1.0,
) -> float:
    training = optimizer is not None
    model.train(training)
    total = 0.0
    n = 0
    for batch in loader:
        batch_t = {
            k: (v.to(device) if torch.is_tensor(v) else v) for k, v in batch.items()
        }
        batch_t = normalizer_batch_fn(batch_t)
        out = model(batch_t)
        loss = out["loss"]
        if training:
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), grad_clip)
            optimizer.step()
        total += float(loss.item())
        n += 1
    return total / max(n, 1)


def train_world_model(
    data_dir: str | Path,
    out_dir: str | Path,
    *,
    max_patients: int = 500,
    max_visits: int = 12,
    epochs: int = 20,
    batch_size: int = 32,
    lr: float = 3e-4,
    hidden_dim: int = 128,
    latent_dim: int = 128,
    device_name: str = "auto",
    seed: int = 42,
    patience: int = 10,
    grad_clip: float = 1.0,
    run_eval: bool = True,
) -> Dict[str, Any]:
    """端到端训练并保存 checkpoint。"""
    torch.manual_seed(seed)
    device = resolve_device(device_name)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    ds = TrajectoryDataset(data_dir, max_patients=max_patients, max_visits=max_visits)
    train_idx, val_idx, test_idx = split_indices(len(ds), seed=seed)
    ds.normalizer = fit_normalizer_on_indices(ds, train_idx)

    def make_loader(indices, shuffle: bool):
        if not indices:
            return None
        return DataLoader(
            Subset(ds, indices),
            batch_size=batch_size,
            shuffle=shuffle,
            collate_fn=collate_trajectories,
        )

    train_loader = make_loader(train_idx, True)
    val_loader = make_loader(val_idx, False)

    model = HCCWorldModel(
        hidden_dim=hidden_dim,
        latent_dim=latent_dim,
        multi_step=2,
        multi_step_weight=0.5,
        residual=True,
    ).to(device)
    optim = torch.optim.AdamW(model.parameters(), lr=lr)

    history = []
    best_val = float("inf")
    best_path = out_dir / "best.pt"
    last_path = out_dir / "last.pt"
    stale = 0

    assert train_loader is not None

    for epoch in range(1, epochs + 1):
        train_loss = _run_epoch(
            model, train_loader, ds.apply_normalizer_to_batch, optim, device, grad_clip
        )
        val_loss = None
        if val_loader is not None:
            with torch.no_grad():
                val_loss = _run_epoch(
                    model,
                    val_loader,
                    ds.apply_normalizer_to_batch,
                    None,
                    device,
                    grad_clip,
                )
        row = {"epoch": epoch, "train_loss": train_loss, "val_loss": val_loss}
        history.append(row)
        print(json.dumps(row), flush=True)

        # 始终保存 last
        payload = {
            "model": model.state_dict(),
            "normalizer": ds.normalizer.state_dict() if ds.normalizer else None,
            "config": {
                "hidden_dim": hidden_dim,
                "latent_dim": latent_dim,
                "max_visits": max_visits,
                "max_patients": max_patients,
                "seed": seed,
                        "research_only": True,
                        "data_source": "synthetic",
                        "model_version": "hcc-wm-mvp-0.2-residual",
                        "residual": True,
                        "multi_step": 2,
                    },
            "train_idx": train_idx,
            "val_idx": val_idx,
            "test_idx": test_idx,
        }
        torch.save(payload, last_path)

        score = val_loss if val_loss is not None else train_loss
        if score < best_val - 1e-6:
            best_val = score
            stale = 0
            torch.save(payload, best_path)
        else:
            stale += 1
            if stale >= patience:
                print(json.dumps({"early_stop": True, "epoch": epoch, "patience": patience}))
                break

    meta: Dict[str, Any] = {
        "best_val": best_val,
        "history": history,
        "device": str(device),
        "checkpoint": str(best_path),
        "n_train": len(train_idx),
        "n_val": len(val_idx),
        "n_test": len(test_idx),
        "research_only": True,
        "patience": patience,
    }

    if run_eval and best_path.exists():
        # 延迟导入，避免循环依赖在模块加载期爆掉
        from packages.training.evaluate import evaluate_checkpoint

        report_path = Path("reports") / f"eval_{out_dir.name}.json"
        try:
            report = evaluate_checkpoint(
                checkpoint=best_path,
                data_dir=data_dir,
                split="test",
                device_name=device_name,
                report_path=report_path,
            )
            meta["eval_report"] = str(report_path)
            meta["beats_persistence_mae"] = report.get("beats_persistence_mae")
            meta["beats_persistence_mae_macro"] = report.get("beats_persistence_mae_macro")
            meta["beats_persistence_mae_ex_afp"] = report.get("beats_persistence_mae_ex_afp")
            meta["test_mae_wm"] = report["world_model"]["mae_mean"]
            meta["test_mae_persistence"] = report["persistence"]["mae_mean"]
            meta["test_mae_macro_wm"] = report["world_model"]["mae_macro"]
            meta["test_mae_macro_persistence"] = report["persistence"]["mae_macro"]
            meta["test_mae_ex_afp_wm"] = report["world_model"]["mae_ex_afp"]
            meta["test_mae_ex_afp_persistence"] = report["persistence"]["mae_ex_afp"]
            print(
                json.dumps(
                    {
                        "eval": True,
                        "beats_persistence_mae_ex_afp": meta["beats_persistence_mae_ex_afp"],
                        "test_mae_ex_afp_wm": meta["test_mae_ex_afp_wm"],
                        "test_mae_ex_afp_persistence": meta["test_mae_ex_afp_persistence"],
                        "report": str(report_path),
                    }
                ),
                flush=True,
            )
        except Exception as exc:  # 评估失败不阻断训练产物
            meta["eval_error"] = str(exc)
            print(json.dumps({"eval_error": str(exc)}), flush=True)

    (out_dir / "train_meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return meta
