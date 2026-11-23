"""产物元数据辅助函数的单元测试（不加载模型）。"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from apps.back.services import artifacts


def _write_json(path: Path, payload: dict) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def test_dataset_summary_from_manifest(tmp_path: Path) -> None:
    data_dir = tmp_path / "synthetic"
    _write_json(
        data_dir / "manifest.json",
        {
            "n": 2,
            "seed": 42,
            "max_visits": 12,
            "data_source": "synthetic",
            "research_only": True,
            "patient_ids": ["SYN00000", "SYN00001"],
        },
    )
    _write_json(data_dir / "SYN00000.json", {"patient_id": "SYN00000"})
    _write_json(data_dir / "SYN00001.json", {"patient_id": "SYN00001"})

    summary = artifacts.dataset_summary(data_dir)

    assert summary["available"] is True
    assert summary["data_source"] == "synthetic"
    assert summary["seed"] == 42
    assert summary["max_visits"] == 12
    assert summary["n_patients_manifest"] == 2
    assert summary["n_patient_ids"] == 2
    # manifest 本身不计入患者文件数
    assert summary["n_patient_files_on_disk"] == 2
    assert summary["manifest"]["exists"] is True
    assert "patient_ids" not in summary  # 不在 API 摘要里暴露大列表


def test_dataset_summary_without_manifest_is_unavailable(tmp_path: Path) -> None:
    data_dir = tmp_path / "synthetic"
    _write_json(data_dir / "SYN00000.json", {"patient_id": "SYN00000"})

    summary = artifacts.dataset_summary(data_dir)

    assert summary["available"] is False
    assert summary["data_source"] is None
    assert summary["n_patient_files_on_disk"] == 1
    assert "manifest.json" in summary["reason"]


def test_training_summary_from_train_meta(tmp_path: Path) -> None:
    checkpoint = tmp_path / "models" / "mvp" / "best.pt"
    checkpoint.parent.mkdir(parents=True)
    checkpoint.write_bytes(b"not-a-real-checkpoint")
    _write_json(
        checkpoint.parent / "train_meta.json",
        {
            "best_val": 0.5,
            "history": [
                {"epoch": 1, "train_loss": 1.0, "val_loss": 0.8},
                {"epoch": 2, "train_loss": 0.9, "val_loss": 0.6},
                {"epoch": 3, "train_loss": 0.8, "val_loss": 0.7},
            ],
            "device": "cpu",
            "n_train": 700,
            "n_val": 150,
            "n_test": 150,
            "patience": 10,
            "eval_report": "reports/eval_mvp.json",
            "research_only": True,
            "beats_persistence_mae": False,
            "test_mae_wm": 10.0,
            "test_mae_persistence": 9.0,
        },
    )

    summary = artifacts.training_summary(checkpoint, include_history=True)

    assert summary["available"] is True
    assert summary["best_epoch"] == 2
    assert summary["best_val"] == 0.6
    assert summary["epochs_trained"] == 3
    assert summary["splits"] == {"n_train": 700, "n_val": 150, "n_test": 150}
    assert summary["beats_persistence"]["mae"] is False
    assert summary["test_mae"]["world_model"] == 10.0
    assert len(summary["history"]) == 3
    assert summary["checkpoint"]["exists"] is True
    assert summary["checkpoint"]["size_bytes"] > 0

    compact = artifacts.training_summary(checkpoint, include_history=False)
    assert "history" not in compact


def test_training_summary_without_train_meta(tmp_path: Path) -> None:
    checkpoint = tmp_path / "models" / "mvp" / "best.pt"
    checkpoint.parent.mkdir(parents=True)
    checkpoint.write_bytes(b"x")

    summary = artifacts.training_summary(checkpoint)

    assert summary["available"] is False
    assert "train_meta.json" in summary["reason"]


def test_list_checkpoints_marks_current(tmp_path: Path) -> None:
    models_dir = tmp_path / "models"
    best = models_dir / "mvp" / "best.pt"
    last = models_dir / "mvp" / "last.pt"
    best.parent.mkdir(parents=True)
    best.write_bytes(b"best")
    last.write_bytes(b"last")

    items = artifacts.list_checkpoints(models_dir, current=best)

    by_name = {item["name"]: item for item in items}
    assert set(by_name) == {"best.pt", "last.pt"}
    assert by_name["best.pt"]["is_current"] is True
    assert by_name["last.pt"]["is_current"] is False
    assert by_name["best.pt"]["relative_path"].endswith("best.pt")
    assert all(item["size_bytes"] > 0 for item in items)


def test_report_summary_and_list(tmp_path: Path) -> None:
    reports_dir = tmp_path / "reports"
    _write_json(
        reports_dir / "eval_mvp.json",
        {
            "model_version": "hcc-wm-mvp-test",
            "checkpoint": "artifacts/models/mvp/best.pt",
            "split": "test",
            "n_patients": 150,
            "data_source": "synthetic",
            "research_only": True,
            "beats_persistence_mae": False,
            "beats_persistence_mae_macro": False,
            "beats_persistence_mae_ex_afp": True,
            "world_model": {"mae_mean": 10.0, "mae_macro": 8.0, "mae_ex_afp": 4.0, "n_valid": 100},
            "persistence": {"mae_mean": 9.0, "mae_macro": 7.0, "mae_ex_afp": 6.0},
            "note": "test",
        },
    )

    summary = artifacts.report_summary(reports_dir / "eval_mvp.json")
    assert summary["available"] is True
    assert summary["model_version"] == "hcc-wm-mvp-test"
    assert summary["beats_persistence_mae_ex_afp"] is True
    assert summary["world_model"]["mae_ex_afp"] == 4.0
    assert summary["persistence"]["mae_ex_afp"] == 6.0
    assert summary["report"]["size_bytes"] > 0

    items = artifacts.list_reports(reports_dir)
    assert len(items) == 1
    assert items[0]["report"]["path"].endswith("eval_mvp.json")


def test_resolve_report_path_rejects_traversal(tmp_path: Path) -> None:
    reports_dir = tmp_path / "reports"
    _write_json(reports_dir / "eval_mvp.json", {"split": "test"})

    resolved = artifacts.resolve_report_path(reports_dir, "eval_mvp.json")
    assert resolved.name == "eval_mvp.json"

    for bad in ("../eval_mvp.json", "sub/eval_mvp.json", "/tmp/eval_mvp.json", "eval_mvp.txt"):
        with pytest.raises(ValueError):
            artifacts.resolve_report_path(reports_dir, bad)

    with pytest.raises(FileNotFoundError):
        artifacts.resolve_report_path(reports_dir, "missing.json")
