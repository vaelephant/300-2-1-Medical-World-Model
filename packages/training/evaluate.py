"""世界模型评估：单步 MAE/RMSE + 多步 rollout + Persistence 对照。

报告默认写入 reports/，所有结果标记 research_only / synthetic。
指标在**原始特征空间**计算，便于解读（AFP、肿瘤大小等）。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

import torch
from torch.utils.data import DataLoader, Subset

from packages.data.dataset import FEATURE_DIM, FeatureNormalizer, TrajectoryDataset, collate_trajectories
from packages.data.schemas import CLINICAL_FEATURE_KEYS as FEATURE_KEYS
from packages.training.baselines import persistence_next_step
from packages.training.rollout import load_model
from packages.training.train import resolve_device, split_indices
from packages.world_model.model import HCCWorldModel


def one_step_feature_metrics(
    pred: torch.Tensor,
    target: torch.Tensor,
    valid: torch.Tensor,
) -> Dict[str, Any]:
    """pred/target/valid: (B, T, F)。返回总体与分特征 MAE/RMSE。"""
    valid_f = valid.float()
    err = pred - target
    abs_err = err.abs() * valid_f
    sq_err = (err ** 2) * valid_f
    denom = valid_f.sum().clamp_min(1.0)
    per_denom = valid_f.sum(dim=(0, 1)).clamp_min(1.0)

    mae_t = abs_err.sum(dim=(0, 1)) / per_denom
    rmse_t = torch.sqrt(sq_err.sum(dim=(0, 1)) / per_denom)
    mae_per = mae_t.tolist()
    rmse_per = rmse_t.tolist()
    # mae_mean：所有有效点微平均（易被 AFP 主导）
    # mae_macro：各特征 MAE 再平均（更适合「是否全面优于基线」）
    afp_i = FEATURE_KEYS.index("afp")
    mask_ex = torch.ones(len(FEATURE_KEYS), dtype=torch.bool)
    mask_ex[afp_i] = False
    return {
        "mae_mean": float(abs_err.sum() / denom),
        "rmse_mean": float(torch.sqrt(sq_err.sum() / denom)),
        "mae_macro": float(mae_t.mean().item()),
        "mae_ex_afp": float(mae_t[mask_ex].mean().item()),
        "mae_per_feature": {
            FEATURE_KEYS[i]: float(mae_per[i]) for i in range(len(FEATURE_KEYS))
        },
        "rmse_per_feature": {
            FEATURE_KEYS[i]: float(rmse_per[i]) for i in range(len(FEATURE_KEYS))
        },
        "n_valid": int(valid_f.sum().item()),
    }


def _move_batch(batch: Dict[str, Any], device: torch.device) -> Dict[str, Any]:
    return {k: (v.to(device) if torch.is_tensor(v) else v) for k, v in batch.items()}


@torch.no_grad()
def evaluate_world_model_one_step(
    model: HCCWorldModel,
    normalizer: FeatureNormalizer,
    loader: DataLoader,
    device: torch.device,
) -> Dict[str, Any]:
    """Teacher-forcing 单步预测，指标在原始空间。"""
    model.eval()
    preds, targets, valids = [], [], []
    for batch in loader:
        batch = _move_batch(batch, device)
        raw_features = batch["features"]
        batch_n = dict(batch)
        batch_n["features"] = normalizer.transform(raw_features)
        out = model(batch_n)
        pred_norm = out["pred_features"]
        pred = normalizer.inverse_transform(pred_norm)
        target = raw_features[:, 1:, :]
        miss_next = batch["missing"][:, 1:, :]
        step_valid = batch["pad_mask"][:, 1:] & batch["pad_mask"][:, :-1]
        valid = step_valid.unsqueeze(-1) & (~miss_next)
        preds.append(pred.cpu())
        targets.append(target.cpu())
        valids.append(valid.cpu())
    return one_step_feature_metrics(
        torch.cat(preds, dim=0),
        torch.cat(targets, dim=0),
        torch.cat(valids, dim=0),
    )


@torch.no_grad()
def evaluate_persistence(loader: DataLoader) -> Dict[str, Any]:
    preds, targets, valids = [], [], []
    for batch in loader:
        pred, target, valid = persistence_next_step(batch)
        preds.append(pred)
        targets.append(target)
        valids.append(valid)
    return one_step_feature_metrics(
        torch.cat(preds, dim=0),
        torch.cat(targets, dim=0),
        torch.cat(valids, dim=0),
    )


@torch.no_grad()
def evaluate_rollout_horizons(
    model: HCCWorldModel,
    normalizer: FeatureNormalizer,
    loader: DataLoader,
    device: torch.device,
    horizons: Sequence[int] = (1, 2, 3, 4),
    context_len: int = 3,
) -> Dict[str, Any]:
    """多步自由 rollout：horizon 以「访视步」计（非日历天）。"""
    model.eval()
    # 累积每个 horizon 的误差
    sum_abs = {h: torch.zeros(FEATURE_DIM) for h in horizons}
    sum_sq = {h: torch.zeros(FEATURE_DIM) for h in horizons}
    count = {h: torch.zeros(FEATURE_DIM) for h in horizons}
    max_h = max(horizons)

    for batch in loader:
        batch = _move_batch(batch, device)
        raw = batch["features"]
        lengths = batch["lengths"]
        missing = batch["missing"]
        pad_mask = batch["pad_mask"]

        # 需要 context + max_h 步真值
        need = context_len + max_h
        keep = lengths >= need
        if not keep.any():
            continue

        # 过滤短序列
        idx = keep.nonzero(as_tuple=False).squeeze(-1)
        sub = {
            k: (v[idx] if torch.is_tensor(v) else [v[i] for i in idx.tolist()])
            for k, v in batch.items()
        }
        sub_n = dict(sub)
        sub_n["features"] = normalizer.transform(sub["features"])
        pred_norm = model.rollout(sub_n, horizon=max_h, context_len=context_len)
        pred = normalizer.inverse_transform(pred_norm)  # (B', max_h, F)

        for hi, h in enumerate(range(1, max_h + 1)):
            if h not in sum_abs:
                continue
            # 真值在 context_len + h - 1
            t_idx = context_len + h - 1
            target = sub["features"][:, t_idx, :]
            miss = sub["missing"][:, t_idx, :]
            # 分特征：该步非 pad 且特征非缺失
            step_ok = sub["pad_mask"][:, t_idx].unsqueeze(-1) & (~miss)
            err = pred[:, h - 1, :] - target
            sum_abs[h] += (err.abs() * step_ok.float()).sum(dim=0).cpu()
            sum_sq[h] += ((err ** 2) * step_ok.float()).sum(dim=0).cpu()
            count[h] += step_ok.float().sum(dim=0).cpu()

    out: Dict[str, Any] = {"context_len": context_len, "horizons": {}}
    for h in horizons:
        c = count[h].clamp_min(1.0)
        mae = (sum_abs[h] / c).tolist()
        rmse = torch.sqrt(sum_sq[h] / c).tolist()
        out["horizons"][str(h)] = {
            "mae_mean": float((sum_abs[h].sum() / c.sum()).item()),
            "rmse_mean": float(torch.sqrt(sum_sq[h].sum() / c.sum()).item()),
            "mae_per_feature": {FEATURE_KEYS[i]: float(mae[i]) for i in range(FEATURE_DIM)},
        }
    return out


def _loader_for_split(
    ds: TrajectoryDataset,
    indices: List[int],
    batch_size: int = 32,
) -> DataLoader:
    return DataLoader(
        Subset(ds, indices),
        batch_size=batch_size,
        shuffle=False,
        collate_fn=collate_trajectories,
    )


def evaluate_checkpoint(
    checkpoint: str | Path,
    data_dir: str | Path,
    *,
    split: str = "test",
    device_name: str = "auto",
    batch_size: int = 32,
    max_patients: Optional[int] = None,
    report_path: Optional[str | Path] = None,
    rollout_horizons: Sequence[int] = (1, 2, 3, 4),
    context_len: int = 3,
) -> Dict[str, Any]:
    """加载 best.pt，在指定 split 上对比 world model vs persistence。"""
    device = resolve_device(device_name)
    model, normalizer, ckpt = load_model(checkpoint, device=device)
    cfg = ckpt.get("config", {})
    max_visits = int(cfg.get("max_visits", 12))
    if max_patients is None:
        max_patients = cfg.get("max_patients")

    ds = TrajectoryDataset(
        data_dir,
        max_patients=max_patients,
        max_visits=max_visits,
    )
    # 优先用 checkpoint 内保存的划分，保证无泄漏评估
    if "train_idx" in ckpt and "test_idx" in ckpt and "val_idx" in ckpt:
        splits = {
            "train": list(ckpt["train_idx"]),
            "val": list(ckpt["val_idx"]),
            "test": list(ckpt["test_idx"]),
        }
    else:
        tr, va, te = split_indices(len(ds), seed=int(cfg.get("seed", 42)))
        splits = {"train": tr, "val": va, "test": te}

    if split not in splits:
        raise ValueError(f"split 必须是 {list(splits)}")
    indices = splits[split]
    if not indices:
        raise RuntimeError(f"split={split} 为空")

    loader = _loader_for_split(ds, indices, batch_size=batch_size)

    wm = evaluate_world_model_one_step(model, normalizer, loader, device)
    pers = evaluate_persistence(loader)
    rollout = evaluate_rollout_horizons(
        model,
        normalizer,
        loader,
        device,
        horizons=rollout_horizons,
        context_len=context_len,
    )

    better_micro = wm["mae_mean"] < pers["mae_mean"]
    better_macro = wm["mae_macro"] < pers["mae_macro"]
    better_ex_afp = wm["mae_ex_afp"] < pers["mae_ex_afp"]
    report = {
        "research_only": True,
        "data_source": "synthetic",
        "model_version": cfg.get("model_version", "unknown"),
        "checkpoint": str(checkpoint),
        "split": split,
        "n_patients": len(indices),
        "world_model": wm,
        "persistence": pers,
        "rollout": rollout,
        "beats_persistence_mae": better_micro,
        "beats_persistence_mae_macro": better_macro,
        "beats_persistence_mae_ex_afp": better_ex_afp,
        "mae_improvement": float(pers["mae_mean"] - wm["mae_mean"]),
        "mae_macro_improvement": float(pers["mae_macro"] - wm["mae_macro"]),
        "note": "合成数据指标≠临床性能；mae_mean 易被 AFP 主导，请同时看 mae_macro / mae_ex_afp。",
    }

    if report_path is not None:
        path = Path(report_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report
