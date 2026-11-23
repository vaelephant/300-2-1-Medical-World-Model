"""本地训练/评估产物的只读元数据辅助。

这些函数只读取磁盘上的 JSON / checkpoint 文件，不加载模型、不访问网络，
用于把「训练历史、数据来源、checkpoint 列表、评估报告 provenance」暴露给 API。

约定：
- 数据目录：``MWM_DATA_DIR``（默认 ``artifacts/synthetic``），其中 ``manifest.json``
  记录生成参数（seed / n / max_visits / data_source）。
- 训练元数据：与 checkpoint 同目录的 ``train_meta.json``（由训练脚本写出）。
- 模型目录：``MWM_MODELS_DIR``（默认 checkpoint 所在的 models 根目录）。
- 评估报告目录：``MWM_REPORTS_DIR``（默认 ``reports``）。
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

DEFAULT_REPORTS_DIR = "reports"


def _iso_mtime(path: Path) -> str:
    return datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat()


def read_json(path: Path) -> Optional[Dict[str, Any]]:
    """读取对象 JSON；文件缺失或损坏时返回 None（不抛异常）。"""
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return payload if isinstance(payload, dict) else None


def artifact_file(path: Optional[Path]) -> Dict[str, Any]:
    """返回单个产物的存在性、大小与修改时间（不会被 JSON 序列化卡住）。"""
    if path is None:
        return {"path": None, "exists": False}
    info: Dict[str, Any] = {"path": str(path), "exists": path.exists()}
    if path.exists():
        stat = path.stat()
        info.update(
            {
                "size_bytes": stat.st_size,
                "modified_at": _iso_mtime(path),
            }
        )
    return info


def dataset_summary(data_dir: Path) -> Dict[str, Any]:
    """合成数据目录与 manifest 的摘要（不返回 patient_ids 大列表）。"""
    data_dir = Path(data_dir)
    manifest_path = data_dir / "manifest.json"
    manifest = read_json(manifest_path)
    patient_files = [
        item for item in data_dir.glob("*.json") if item.name != manifest_path.name
    ]
    summary: Dict[str, Any] = {
        "directory": str(data_dir),
        "available": manifest is not None,
        "manifest": artifact_file(manifest_path),
        "n_patient_files_on_disk": len(patient_files),
        "data_source": manifest.get("data_source") if manifest else None,
        "seed": manifest.get("seed") if manifest else None,
        "max_visits": manifest.get("max_visits") if manifest else None,
        "n_patients_manifest": manifest.get("n") if manifest else None,
        "n_patient_ids": len(manifest.get("patient_ids", [])) if manifest else None,
        "research_only": bool(manifest.get("research_only", True)) if manifest else True,
    }
    if manifest is None:
        summary["reason"] = "未找到 manifest.json；数据来源无法从产物派生。"
    return summary


def training_summary(checkpoint: Path, include_history: bool = True) -> Dict[str, Any]:
    """读取 checkpoint 同目录的 train_meta.json，返回训练摘要与逐 epoch 曲线。"""
    checkpoint = Path(checkpoint)
    meta_path = checkpoint.parent / "train_meta.json"
    meta = read_json(meta_path)
    if meta is None:
        return {
            "available": False,
            "checkpoint": artifact_file(checkpoint),
            "train_meta": artifact_file(meta_path),
            "reason": "未找到 checkpoint 同目录的 train_meta.json；训练历史不可用。",
        }

    history = [row for row in meta.get("history", []) if isinstance(row, dict)]
    best_epoch: Optional[int] = None
    best_val: Optional[float] = None
    for row in history:
        val_loss = row.get("val_loss")
        if not isinstance(val_loss, (int, float)):
            continue
        if best_val is None or float(val_loss) < best_val:
            best_val = float(val_loss)
            best_epoch = row.get("epoch") if isinstance(row.get("epoch"), int) else None

    summary: Dict[str, Any] = {
        "available": True,
        "checkpoint": artifact_file(checkpoint),
        "train_meta": artifact_file(meta_path),
        # best_val / best_epoch 以 history 的实际最小 val_loss 为准；
        # 同时保留 train_meta 里记录的 best_val（reported_best_val）供核对。
        "best_val": best_val if best_val is not None else meta.get("best_val"),
        "reported_best_val": meta.get("best_val"),
        "best_epoch": best_epoch,
        "epochs_trained": len(history),
        "splits": {
            "n_train": meta.get("n_train"),
            "n_val": meta.get("n_val"),
            "n_test": meta.get("n_test"),
        },
        "device": meta.get("device"),
        "patience": meta.get("patience"),
        "eval_report": meta.get("eval_report"),
        "config": meta.get("config"),
        "data_manifest": meta.get("data_manifest"),
        "epochs_configured": meta.get("epochs_configured"),
        "started_at": meta.get("started_at"),
        "finished_at": meta.get("finished_at"),
        "duration_sec": meta.get("duration_sec"),
        "num_workers": meta.get("num_workers"),
        "torch_version": meta.get("torch_version"),
        "model_version": meta.get("model_version"),
        "last_checkpoint": meta.get("last_checkpoint"),
        "research_only": bool(meta.get("research_only", True)),
        "beats_persistence": {
            "mae": meta.get("beats_persistence_mae"),
            "mae_macro": meta.get("beats_persistence_mae_macro"),
        },
        "test_mae": {
            "world_model": meta.get("test_mae_wm"),
            "persistence": meta.get("test_mae_persistence"),
            "mae_macro_world_model": meta.get("test_mae_macro_wm"),
            "mae_macro_persistence": meta.get("test_mae_macro_persistence"),
        },
        "note": "训练历史来自 checkpoint 同目录 train_meta.json；重新训练后请同步更新。",
    }
    if include_history:
        summary["history"] = history
    return summary


def list_checkpoints(models_dir: Path, current: Optional[Path] = None) -> List[Dict[str, Any]]:
    """列出模型目录下的所有 .pt（包含子目录），按修改时间倒序。"""
    models_dir = Path(models_dir)
    current_resolved = Path(current).resolve() if current is not None else None
    items: List[Dict[str, Any]] = []
    if not models_dir.exists():
        return items
    for path in models_dir.rglob("*.pt"):
        try:
            resolved = path.resolve()
        except OSError:
            resolved = path
        info = {
            "name": path.name,
            "relative_path": str(path.relative_to(models_dir)),
            **artifact_file(path),
        }
        info["is_current"] = bool(current_resolved is not None and resolved == current_resolved)
        items.append(info)
    items.sort(key=lambda item: item.get("modified_at") or "", reverse=True)
    return items


def report_summary(path: Path) -> Dict[str, Any]:
    """单个评估报告的摘要；用于报告列表与 provenance，不返回完整逐特征表。"""
    path = Path(path)
    info = artifact_file(path)
    report = read_json(path)
    if report is None:
        return {
            "available": False,
            "report": info,
            "reason": "报告不存在或不是合法 JSON。",
        }
    world_model = report.get("world_model") or {}
    persistence = report.get("persistence") or {}
    return {
        "available": True,
        "report": info,
        "model_version": report.get("model_version"),
        "checkpoint": report.get("checkpoint"),
        "split": report.get("split"),
        "n_patients": report.get("n_patients"),
        "data_source": report.get("data_source"),
        "research_only": bool(report.get("research_only", True)),
        "beats_persistence_mae": report.get("beats_persistence_mae"),
        "beats_persistence_mae_macro": report.get("beats_persistence_mae_macro"),
        "beats_persistence_mae_ex_afp": report.get("beats_persistence_mae_ex_afp"),
        "world_model": {
            "mae_mean": world_model.get("mae_mean"),
            "mae_macro": world_model.get("mae_macro"),
            "mae_ex_afp": world_model.get("mae_ex_afp"),
            "n_valid": world_model.get("n_valid"),
        },
        "persistence": {
            "mae_mean": persistence.get("mae_mean"),
            "mae_macro": persistence.get("mae_macro"),
            "mae_ex_afp": persistence.get("mae_ex_afp"),
        },
        "note": report.get("note"),
    }


def list_reports(reports_dir: Path) -> List[Dict[str, Any]]:
    """列出 reports/ 下的所有 .json 评估报告摘要，按修改时间倒序。"""
    reports_dir = Path(reports_dir)
    if not reports_dir.exists():
        return []
    items = [report_summary(path) for path in sorted(reports_dir.glob("*.json"))]
    items.sort(key=lambda item: (item.get("report") or {}).get("modified_at") or "", reverse=True)
    return items


def training_live(checkpoint: Path, stale_after_seconds: int = 120) -> Dict[str, Any]:
    """读取 out_dir/train_progress.json；没有 progress 时回退到 train_meta。

    训练脚本每个 epoch 原子写一次 progress，因此前端可轮询获得实时曲线。
    """
    checkpoint = Path(checkpoint)
    progress_path = checkpoint.parent / "train_progress.json"
    progress = read_json(progress_path)
    meta = training_summary(checkpoint, include_history=True)
    now = datetime.now(tz=timezone.utc)

    if progress is not None:
        payload: Dict[str, Any] = dict(progress)
        status = str(payload.get("status") or "running")
        stale_seconds: Optional[int] = None
        raw_updated = payload.get("updated_at")
        if isinstance(raw_updated, str):
            try:
                updated = datetime.fromisoformat(raw_updated)
                if updated.tzinfo is None:
                    updated = updated.replace(tzinfo=timezone.utc)
                stale_seconds = max(0, int((now - updated).total_seconds()))
            except ValueError:
                stale_seconds = None
        stale = bool(
            stale_seconds is not None
            and stale_seconds > stale_after_seconds
            and status in {"running", "evaluating"}
        )
        payload.update(
            {
                "available": True,
                "source": "progress",
                "status": status,
                "stalled": stale,
                "stale_after_seconds": stale_after_seconds,
                "stale_seconds": stale_seconds,
                "progress_file": artifact_file(progress_path),
                "train_meta": meta,
                "epochs_trained": len(payload.get("history") or []),
            }
        )
        if stale:
            payload["message"] = (
                f"train_progress.json 已超过 {stale_after_seconds}s 未更新；"
                "训练可能变慢/中断，或进程仍在写评估。"
            )
        return payload

    if meta.get("available"):
        payload = dict(meta)
        # training_summary 里 checkpoint 是 artifact_file 对象；实时 payload 需要 string path。
        checkpoint_info = payload.get("checkpoint")
        if isinstance(checkpoint_info, dict):
            payload["checkpoint_file"] = checkpoint_info
            payload["checkpoint"] = checkpoint_info.get("path")
        payload.update(
            {
                "available": True,
                "source": "train_meta",
                "status": "finished",
                "stalled": False,
                "stale_seconds": None,
                "progress_file": artifact_file(progress_path),
                "epochs_trained": len(meta.get("history") or []),
                "message": "未找到 train_progress.json，显示最近一次训练结束后的 train_meta。",
            }
        )
        return payload

    return {
        "available": False,
        "source": "none",
        "status": "idle",
        "stalled": False,
        "stale_seconds": None,
        "progress_file": artifact_file(progress_path),
        "message": "没有找到训练进度或 train_meta；请先运行训练脚本。",
    }


def resolve_report_path(reports_dir: Path, name: Optional[str]) -> Path:
    """把报告文件名安全地解析为 reports/ 下的路径。

    只接受单一文件名（``eval_mvp.json``），拒绝路径分隔符、``..`` 与绝对路径，
    防止通过查询参数越权读取任意文件。
    """
    reports_dir = Path(reports_dir)
    raw = name or os.environ.get("MWM_EVAL_REPORT", "eval_mvp.json")
    candidate = Path(raw)
    if candidate.name != raw or candidate.suffix.lower() != ".json" or candidate.is_absolute():
        raise ValueError(f"非法报告文件名：{raw!r}（应为 reports/ 下的 .json 文件名）")
    path = (reports_dir / candidate).resolve()
    root = reports_dir.resolve()
    if path.parent != root:
        raise ValueError(f"报告不在 reports 目录内：{raw!r}")
    if not path.is_file():
        raise FileNotFoundError(f"评估报告不存在：{path}")
    return path
