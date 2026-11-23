"""训练评估：Persistence 对照 + 世界模型单步指标。"""

from __future__ import annotations

from pathlib import Path
import json

import pytest
import torch

from packages.data.dataset import TrajectoryDataset, collate_trajectories
from packages.training.baselines import persistence_next_step
from packages.training.evaluate import evaluate_checkpoint, one_step_feature_metrics
from packages.training.train import split_indices, train_world_model


ROOT = Path(__file__).resolve().parents[1]
SYN_DIR = ROOT / "artifacts" / "synthetic"


def test_persistence_shapes():
    ds = TrajectoryDataset(SYN_DIR, max_patients=8, max_visits=10)
    batch = collate_trajectories([ds[i] for i in range(4)])
    pred, target, valid = persistence_next_step(batch)
    assert pred.shape == target.shape
    assert valid.shape == target.shape
    assert valid.any()


def test_one_step_metrics_finite():
    ds = TrajectoryDataset(SYN_DIR, max_patients=8, max_visits=10)
    batch = collate_trajectories([ds[i] for i in range(4)])
    pred, target, valid = persistence_next_step(batch)
    metrics = one_step_feature_metrics(pred, target, valid)
    assert "mae_mean" in metrics
    assert metrics["mae_mean"] >= 0.0


def test_train_then_evaluate_writes_report(tmp_path):
    out = tmp_path / "model"
    meta = train_world_model(
        data_dir=SYN_DIR,
        out_dir=out,
        max_patients=40,
        max_visits=8,
        epochs=2,
        batch_size=8,
        device_name="cpu",
        seed=0,
        patience=5,
    )
    # train_meta / checkpoint 应记录可追溯的训练信息。
    assert meta["best_epoch"] is not None
    assert meta["epochs_trained"] == 2
    assert meta["config"]["model_version"]
    assert meta["data_source"] == "synthetic"
    assert meta["data_manifest"]["exists"] is True
    assert meta["torch_version"]
    assert (out / "best.pt").exists()
    assert (out / "last.pt").exists()
    assert (out / "train_meta.json").exists()
    progress = json.loads((out / "train_progress.json").read_text(encoding="utf-8"))
    assert progress["status"] == "finished"
    assert progress["epochs_trained"] == 2
    assert progress["checkpoint"].endswith("best.pt")

    report = evaluate_checkpoint(
        checkpoint=out / "best.pt",
        data_dir=SYN_DIR,
        split="test",
        device_name="cpu",
        report_path=tmp_path / "eval.json",
    )
    assert report["research_only"] is True
    assert "world_model" in report
    assert "persistence" in report
    assert report["data_source"] == "synthetic"
    # 显式方向的 delta 字段 + 兼容旧字段。
    assert "mae_delta_model_minus_persistence" in report
    assert "mae_macro_delta_model_minus_persistence" in report
    assert "mae_improvement_definition" in report
    wm_macro = report["world_model"]["mae_macro"]
    pers_macro = report["persistence"]["mae_macro"]
    if wm_macro is not None and pers_macro is not None:
        assert report["mae_macro_delta_model_minus_persistence"] == pytest.approx(
            wm_macro - pers_macro
        )
    # rollout 现在也提供排除 AFP 的宏平均与有效样本数。
    horizon = report["rollout"]["horizons"]["1"]
    assert "mae_ex_afp" in horizon
    assert "n_valid" in horizon
    assert (tmp_path / "eval.json").exists()
