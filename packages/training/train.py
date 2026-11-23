"""世界模型训练循环（MVP）。

改进点：
- normalizer 只在 train split 上拟合，且逐特征忽略缺失位 / padding 位（防泄漏 + 防偏置）
- 随机种子覆盖 python / numpy / torch / cuda；DataLoader worker 也有确定性种子
- DataLoader 支持 num_workers / pin_memory，训练与验证分离
- early stopping（patience）；checkpoint 与 train_meta 记录 best_epoch、config、数据 manifest 与时间戳
"""

from __future__ import annotations

import json
import random
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import torch
from torch.utils.data import DataLoader, Subset

from packages.data.dataset import (
    FeatureNormalizer,
    TrajectoryDataset,
    collate_trajectories,
    compute_feature_normalizer,
)
from packages.data.splits import split_indices
from packages.world_model.model import HCCWorldModel

DEFAULT_MODEL_VERSION = "hcc-wm-mvp-0.2-residual"


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


def set_global_seed(seed: int, deterministic: bool = False) -> int:
    """统一设置随机种子，避免只种 torch CPU 导致 DataLoader / numpy 不可复现。"""
    seed = int(seed)
    random.seed(seed)
    try:
        import numpy as np  # 可选依赖

        np.random.seed(seed)
    except ImportError:  # pragma: no cover - 训练环境通常有 numpy
        pass
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)
    if deterministic:
        torch.backends.cudnn.deterministic = True
        torch.backends.cudnn.benchmark = False
        try:  # 不是所有算子都支持 strict deterministic，用 warn_only 避免训练中断
            torch.use_deterministic_algorithms(True, warn_only=True)
        except (AttributeError, RuntimeError):  # pragma: no cover
            pass
    return seed


def _seed_worker(worker_id: int) -> None:
    worker_seed = torch.initial_seed() % 2**32
    random.seed(worker_seed)
    torch.manual_seed(worker_seed)
    try:
        import numpy as np

        np.random.seed(worker_seed)
    except ImportError:  # pragma: no cover
        pass


def _read_manifest(data_dir: str | Path) -> Dict[str, Any]:
    """读取数据目录 manifest（若存在），用于 train_meta provenance。"""
    path = Path(data_dir) / "manifest.json"
    info: Dict[str, Any] = {"path": str(path), "exists": path.is_file()}
    if not path.is_file():
        return info
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return info
    if not isinstance(payload, dict):
        return info
    info.update(
        {
            "n": payload.get("n"),
            "seed": payload.get("seed"),
            "max_visits": payload.get("max_visits"),
            "data_source": payload.get("data_source"),
            "research_only": payload.get("research_only"),
        }
    )
    return info


def fit_normalizer_on_indices(
    ds: TrajectoryDataset, indices: List[int]
) -> FeatureNormalizer:
    """仅用指定样本估计 mean/std；逐特征忽略缺失位与 padding 位。"""
    if not indices:
        raise ValueError("fit_normalizer_on_indices 需要至少一个样本")
    batch = collate_trajectories([ds[i] for i in indices])
    missing = batch["missing"] | (~batch["pad_mask"]).unsqueeze(-1)
    normalizer = compute_feature_normalizer(batch["features"], missing, log_afp=True)
    ds.normalizer = normalizer
    return normalizer


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
    context = torch.enable_grad() if training else torch.inference_mode()
    with context:
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
            total += float(loss.detach().item())
            n += 1
    return total / max(n, 1)


def _utc_now() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


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
    dropout: float = 0.1,
    multi_step: int = 2,
    multi_step_weight: float = 0.5,
    device_name: str = "auto",
    seed: int = 42,
    patience: int = 10,
    grad_clip: float = 1.0,
    num_workers: int = 0,
    pin_memory: Optional[bool] = None,
    deterministic: bool = False,
    model_version: str = DEFAULT_MODEL_VERSION,
    predict_uncertainty: bool = False,
    run_eval: bool = True,
) -> Dict[str, Any]:
    """端到端训练并保存 checkpoint / train_meta。"""
    if max_patients < 1:
        raise ValueError(f"max_patients 必须 >= 1，实际 {max_patients}")
    if epochs < 1:
        raise ValueError(f"epochs 必须 >= 1，实际 {epochs}")
    if batch_size < 1:
        raise ValueError(f"batch_size 必须 >= 1，实际 {batch_size}")
    if num_workers < 0:
        raise ValueError(f"num_workers 必须 >= 0，实际 {num_workers}")

    started_at = _utc_now()
    started_clock = time.perf_counter()
    set_global_seed(seed, deterministic=deterministic)
    device = resolve_device(device_name)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest = _read_manifest(data_dir)
    data_source = manifest.get("data_source") or "unknown"

    ds = TrajectoryDataset(data_dir, max_patients=max_patients, max_visits=max_visits)
    train_idx, val_idx, test_idx = split_indices(len(ds), seed=seed)
    fit_normalizer_on_indices(ds, train_idx)

    pin = bool(pin_memory) if pin_memory is not None else device.type == "cuda"

    def make_loader(indices: List[int], shuffle: bool) -> Optional[DataLoader]:
        if not indices:
            return None
        generator = torch.Generator().manual_seed(seed + (1 if shuffle else 0))
        return DataLoader(
            Subset(ds, indices),
            batch_size=batch_size,
            shuffle=shuffle,
            collate_fn=collate_trajectories,
            num_workers=num_workers,
            pin_memory=pin,
            persistent_workers=num_workers > 0,
            worker_init_fn=_seed_worker if num_workers > 0 else None,
            generator=generator if shuffle else None,
        )

    train_loader = make_loader(train_idx, True)
    val_loader = make_loader(val_idx, False)
    assert train_loader is not None

    model = HCCWorldModel(
        hidden_dim=hidden_dim,
        latent_dim=latent_dim,
        dropout=dropout,
        multi_step=multi_step,
        multi_step_weight=multi_step_weight,
        residual=True,
    ).to(device)
    optim = torch.optim.AdamW(model.parameters(), lr=lr)

    config: Dict[str, Any] = {
        "hidden_dim": hidden_dim,
        "latent_dim": latent_dim,
        "dropout": dropout,
        "multi_step": multi_step,
        "multi_step_weight": multi_step_weight,
        "residual": True,
        "max_visits": max_visits,
        "max_patients": max_patients,
        "seed": seed,
        "predict_uncertainty": bool(predict_uncertainty),
        "research_only": True,
        "data_source": data_source,
        "model_version": model_version,
    }

    history: List[Dict[str, Any]] = []
    best_val = float("inf")
    best_epoch: Optional[int] = None
    best_path = out_dir / "best.pt"
    last_path = out_dir / "last.pt"
    stale = 0

    for epoch in range(1, epochs + 1):
        train_loss = _run_epoch(
            model, train_loader, ds.apply_normalizer_to_batch, optim, device, grad_clip
        )
        val_loss: Optional[float] = None
        if val_loader is not None:
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

        payload = {
            "model": model.state_dict(),
            "normalizer": ds.normalizer.state_dict() if ds.normalizer else None,
            "config": config,
            "train_idx": train_idx,
            "val_idx": val_idx,
            "test_idx": test_idx,
        }
        # 始终保存 last（崩溃/中断可恢复），best 按 val_loss 更新。
        torch.save(payload, last_path)

        score = val_loss if val_loss is not None else train_loss
        if score < best_val - 1e-6:
            best_val = score
            best_epoch = epoch
            stale = 0
            torch.save(payload, best_path)
        else:
            stale += 1
            if stale >= patience:
                print(json.dumps({"early_stop": True, "epoch": epoch, "patience": patience}))
                break

    if not best_path.exists():
        # 极端情况下（例如 epochs=0 被外部绕过）至少把 last 当作 best。
        torch.save(payload, best_path)

    meta: Dict[str, Any] = {
        "best_val": best_val if best_val != float("inf") else None,
        "best_epoch": best_epoch,
        "history": history,
        "epochs_configured": epochs,
        "epochs_trained": len(history),
        "device": str(device),
        "device_name": device_name,
        "checkpoint": str(best_path),
        "last_checkpoint": str(last_path),
        "n_train": len(train_idx),
        "n_val": len(val_idx),
        "n_test": len(test_idx),
        "seed": seed,
        "deterministic": deterministic,
        "num_workers": num_workers,
        "research_only": True,
        "patience": patience,
        "config": config,
        "model_version": model_version,
        "data_source": data_source,
        "data_manifest": manifest,
        "torch_version": torch.__version__,
        "started_at": started_at,
        "finished_at": _utc_now(),
        "duration_sec": round(time.perf_counter() - started_clock, 3),
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
                num_workers=num_workers,
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
