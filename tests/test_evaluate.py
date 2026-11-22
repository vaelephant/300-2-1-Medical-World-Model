"""训练评估：Persistence 对照 + 世界模型单步指标。"""

from __future__ import annotations

from pathlib import Path

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
    train_world_model(
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
    assert (tmp_path / "eval.json").exists()
