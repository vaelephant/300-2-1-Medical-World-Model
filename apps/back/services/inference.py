"""推理服务：加载 checkpoint，提供患者读取与 forecast。

环境变量：
  MWM_CHECKPOINT  默认 artifacts/models/mvp/best.pt
  MWM_DATA_DIR    默认 artifacts/synthetic
  MWM_DEVICE      默认 auto（解析为 cpu/mps/cuda）
"""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional

import torch

from packages.data.dataset import (
    FEATURE_DIM,
    TREATMENT_DIM,
    TREATMENT_MODALITIES,
    TrajectoryDataset,
    collate_trajectories,
    trajectory_to_tensors,
)
from packages.data.schemas import CLINICAL_FEATURE_KEYS, PatientTrajectory, TreatmentModality
from packages.training.rollout import load_model, rollout_batch
from packages.training.train import resolve_device

from apps.back.services.artifacts import (
    dataset_summary,
    list_checkpoints,
    list_reports,
    report_summary,
    resolve_report_path,
    training_live,
    training_summary,
)


class InferenceService:
    def __init__(
        self,
        checkpoint: Optional[str | Path] = None,
        data_dir: Optional[str | Path] = None,
        device_name: Optional[str] = None,
        max_patients: Optional[int] = None,
    ) -> None:
        self.checkpoint = Path(
            checkpoint or os.environ.get("MWM_CHECKPOINT", "artifacts/models/mvp/best.pt")
        )
        self.data_dir = Path(
            data_dir or os.environ.get("MWM_DATA_DIR", "artifacts/synthetic")
        )
        self.device_name = device_name or os.environ.get("MWM_DEVICE", "auto")
        self.device = resolve_device(self.device_name)
        # 产物目录：checkpoint 所在 models 根目录与 reports/ 均可通过环境变量覆盖。
        self.models_dir = Path(
            os.environ.get("MWM_MODELS_DIR", str(self.checkpoint.parent.parent))
        )
        self.reports_dir = Path(os.environ.get("MWM_REPORTS_DIR", "reports"))

        if not self.checkpoint.exists():
            raise FileNotFoundError(f"找不到权重：{self.checkpoint}")
        if not self.data_dir.exists():
            raise FileNotFoundError(f"找不到数据目录：{self.data_dir}")

        self.model, self.normalizer, self.ckpt = load_model(
            self.checkpoint, device=self.device
        )
        self.config = dict(self.ckpt.get("config", {}))
        self.model_version = str(self.config.get("model_version", "unknown"))

        # 推理端加载完整队列：checkpoint 里的 max_patients 是训练子集上限，
        # 不能拿来截断演示患者（否则重训后精选病例会 404）。
        cap = max_patients
        if cap is None:
            env_cap = int(os.environ.get("MWM_MAX_PATIENTS", "0") or 0)
            cap = env_cap if env_cap > 0 else None
        self.dataset = TrajectoryDataset(
            self.data_dir,
            max_patients=cap,
            max_visits=int(self.config.get("max_visits", 12)),
        )
        self._id_to_idx = {
            self.dataset[i]["patient_id"]: i for i in range(len(self.dataset))
        }
        self._traj_cache: Dict[str, PatientTrajectory] = {}
        # 数据来源优先从 manifest 派生；缺失时退回单个患者轨迹字段 / unknown。
        self._dataset = dataset_summary(self.data_dir)
        self.data_source = self._dataset.get("data_source") or "unknown"
        self._max_patients = cap
        self._checkpoint_signature = self._checkpoint_signature_now()
        self._reload_lock = threading.RLock()

    # ------------------------------------------------------------------
    def _checkpoint_signature_now(self) -> Optional[tuple]:
        try:
            stat = self.checkpoint.stat()
        except OSError:
            return None
        return (stat.st_mtime_ns, stat.st_size)

    @property
    def checkpoint_changed_on_disk(self) -> bool:
        return self._checkpoint_signature_now() != self._checkpoint_signature

    def reload_checkpoint(self, force: bool = False) -> Dict[str, Any]:
        """重新加载磁盘上的 checkpoint（训练覆盖 best.pt 后使用）。

        ``force=False`` 时只在文件 mtime/size 变化时重载；``force=True`` 强制重载。
        重载会同时刷新 normalizer / config / dataset（manifest 可能变化）。
        注意：重载与推理并发时没有全局推理锁；建议在前端显式点击、空闲时执行。
        """
        with self._reload_lock:
            signature = self._checkpoint_signature_now()
            changed = signature != self._checkpoint_signature
            if not force and not changed:
                return {
                    "reloaded": False,
                    "changed": False,
                    "model_version": self.model_version,
                    "checkpoint": str(self.checkpoint),
                    "message": "checkpoint 未变化；如需强制重载请传 force=true。",
                }
            previous_version = self.model_version
            previous_signature = self._checkpoint_signature
            model, normalizer, ckpt = load_model(self.checkpoint, device=self.device)
            config = dict(ckpt.get("config", {}))
            model_version = str(config.get("model_version", "unknown"))
            cap = self._max_patients
            dataset = TrajectoryDataset(
                self.data_dir,
                max_patients=cap,
                max_visits=int(config.get("max_visits", 12)),
            )
            self.model = model
            self.normalizer = normalizer
            self.ckpt = ckpt
            self.config = config
            self.model_version = model_version
            self.dataset = dataset
            self._id_to_idx = {
                dataset[i]["patient_id"]: i for i in range(len(dataset))
            }
            self._traj_cache = {}
            self._dataset = dataset_summary(self.data_dir)
            self.data_source = self._dataset.get("data_source") or "unknown"
            self._max_patients = cap
            self._checkpoint_signature = signature
            return {
                "reloaded": True,
                "changed": bool(changed),
                "previous_model_version": previous_version,
                "model_version": model_version,
                "checkpoint": str(self.checkpoint),
                "previous_checkpoint_signature": previous_signature,
                "checkpoint_signature": signature,
                "message": "已重新加载磁盘上的 checkpoint / normalizer / config。",
            }

    # ------------------------------------------------------------------
    def training_live_info(self) -> Dict[str, Any]:
        """最近一次/正在进行的训练进度（train_progress.json 或 train_meta）。"""
        payload = training_live(self.checkpoint)
        payload["checkpoint_changed_on_disk"] = self.checkpoint_changed_on_disk
        return payload

    # ------------------------------------------------------------------
    def dataset_info(self) -> Dict[str, Any]:
        """数据集 manifest 摘要（seed / n / max_visits / data_source）。"""
        return dict(self._dataset)

    def current_report_path(self) -> Path:
        """当前评估报告路径。

        - ``MWM_EVAL_REPORT`` 若包含路径分隔符，按显式路径处理（兼容旧配置）；
        - 否则视为 reports/ 下的文件名，交给 ``resolve_report_path`` 做安全校验。
        """
        raw = os.environ.get("MWM_EVAL_REPORT")
        if raw and ("/" in raw or "\\" in raw or os.sep in raw):
            return Path(raw)
        try:
            return resolve_report_path(self.reports_dir, None)
        except (ValueError, FileNotFoundError):
            return self.reports_dir / "eval_mvp.json"

    def provenance(self) -> Dict[str, Any]:
        """当前服务使用的数据、checkpoint、评估报告的 provenance。"""
        current_report = report_summary(self.current_report_path())
        return {
            "research_only": True,
            "data_source": self.data_source,
            "dataset": self.dataset_info(),
            "checkpoint": {
                "path": str(self.checkpoint),
                "model_version": self.model_version,
                "training": training_summary(self.checkpoint, include_history=False),
            },
            "current_report": current_report,
            "reports": list_reports(self.reports_dir),
            "checkpoints": list_checkpoints(self.models_dir, current=self.checkpoint),
            "note": (
                "provenance 全部由本地产物派生：manifest.json / train_meta.json / "
                "checkpoint 文件 / reports/*.json；未提供的数据不会用占位数值代替。"
            ),
        }

    def training_info(self) -> Dict[str, Any]:
        """训练历史与 split 摘要（来自 checkpoint 同目录 train_meta.json）。"""
        summary = training_summary(self.checkpoint, include_history=True)
        summary["model_version"] = self.model_version
        summary["checkpoint_path"] = str(self.checkpoint)
        return summary

    def checkpoints(self) -> List[Dict[str, Any]]:
        return list_checkpoints(self.models_dir, current=self.checkpoint)

    def reports(self) -> List[Dict[str, Any]]:
        return list_reports(self.reports_dir)

    # ------------------------------------------------------------------
    def meta(self) -> Dict[str, Any]:
        training = training_summary(self.checkpoint, include_history=False)
        return {
            "model_version": self.model_version,
            "checkpoint": str(self.checkpoint),
            "data_source": self.data_source,
            "research_only": True,
            "device": str(self.device),
            "n_patients_loaded": len(self.dataset),
            "config": {
                "hidden_dim": self.config.get("hidden_dim"),
                "latent_dim": self.config.get("latent_dim"),
                "residual": self.config.get("residual", True),
                "max_visits": self.config.get("max_visits"),
            },
            "training": {
                "available": training.get("available"),
                "best_val": training.get("best_val"),
                "best_epoch": training.get("best_epoch"),
                "epochs_trained": training.get("epochs_trained"),
                "splits": training.get("splits"),
                "train_meta": training.get("train_meta"),
            },
            "predictive_uncertainty": {
                "available": False,
                "reason": (
                    "MVP 动力学为确定性均值模型，未输出预测分布；"
                    "config.predict_uncertainty 仅为规划开关，当前不应解读为置信区间。"
                ),
            },
        }

    def list_patients(self, limit: int = 50, offset: int = 0) -> List[Dict[str, Any]]:
        ids = list(self._id_to_idx.keys())[offset : offset + limit]
        out = []
        for pid in ids:
            traj = self.get_trajectory(pid)
            p = traj.patient
            out.append(
                {
                    "patient_id": p.patient_id,
                    "sex": p.sex.value if hasattr(p.sex, "value") else p.sex,
                    "age_at_index": p.age_at_index,
                    "bclc_stage": p.bclc_stage.value
                    if hasattr(p.bclc_stage, "value")
                    else p.bclc_stage,
                    "child_pugh": p.child_pugh.value
                    if hasattr(p.child_pugh, "value")
                    else p.child_pugh,
                    "n_visits": len(traj.visits),
                    "data_source": p.data_source,
                    "research_only": True,
                }
            )
        return out

    def get_trajectory(self, patient_id: str) -> PatientTrajectory:
        if patient_id in self._traj_cache:
            return self._traj_cache[patient_id]
        if patient_id not in self._id_to_idx:
            raise KeyError(patient_id)
        path = self.data_dir / f"{patient_id}.json"
        if not path.exists():
            raise KeyError(patient_id)
        traj = PatientTrajectory.model_validate(
            json.loads(path.read_text(encoding="utf-8"))
        )
        self._traj_cache[patient_id] = traj
        return traj

    def forecast(
        self,
        patient_id: str,
        horizon: int = 4,
        context_len: int = 3,
        treatment_modality: TreatmentModality | None = None,
        dose_intensity: float = 1.0,
    ) -> Dict[str, Any]:
        traj = self.get_trajectory(patient_id)
        tensors = trajectory_to_tensors(
            traj, max_visits=int(self.config.get("max_visits", 12))
        )
        batch = collate_trajectories([tensors])
        # 移到 device
        batch_dev = {
            k: (v.to(self.device) if torch.is_tensor(v) else v) for k, v in batch.items()
        }
        L = int(batch_dev["lengths"][0].item())
        if L == 0:
            raise ValueError("患者没有可用随访")
        ctx = min(max(context_len, 1), L)
        future_treatment = None
        if treatment_modality is not None:
            future_treatment = torch.zeros((1, horizon, TREATMENT_DIM), device=self.device)
            future_treatment[:, :, TREATMENT_MODALITIES.index(treatment_modality.value)] = 1.0
            future_treatment[:, :, -1] = dose_intensity
        with torch.no_grad():
            pred = rollout_batch(
                self.model,
                self.normalizer,
                batch_dev,
                horizon=horizon,
                context_len=ctx,
                future_treatment=future_treatment,
            )  # (1, H, F)

        # 与 rollout 使用相同的上下文与时间间隔；后续真实随访仅供回顾比较。
        hist_days = [v.observation.days_from_index for v in traj.visits[:ctx]]
        last_day = hist_days[-1]
        mean_gap = (float(batch_dev["delta_t"][0, 1:ctx].mean().item())
                    if ctx > 1 else 30.0)

        predictions = []
        for h in range(horizon):
            feats = {
                CLINICAL_FEATURE_KEYS[j]: float(pred[0, h, j].item())
                for j in range(FEATURE_DIM)
            }
            predictions.append(
                {
                    "step": h + 1,
                    "days_from_index": last_day + mean_gap * (h + 1),
                    "features": feats,
                }
            )

        return {
            "patient_id": patient_id,
            "model_version": self.model_version,
            "data_source": getattr(traj.patient, "data_source", None) or self.data_source,
            "research_only": True,
            "prediction_horizon": horizon,
            "context_len": ctx,
            "forecast_origin_day": last_day,
            "step_days": mean_gap,
            "uncertainty": None,  # MVP 残差均值模型尚未输出分布
            "uncertainty_status": {
                "available": False,
                "method": None,
                "reason": (
                    "MVP 动力学为确定性均值模型，未输出预测分布；"
                    "config.predict_uncertainty 仅为规划开关，当前不应解读为置信区间。"
                ),
            },
            "history_days": hist_days,
            "predictions": predictions,
            "note": "研究原型输出，非临床结论；轨迹来自合成数据动力学学习。",
        }

    def cohort_summary(self) -> Dict[str, Any]:
        """全队列摘要：每患者基线/末次指标、治疗事件、结局与随访跨度。

        只读本地合成轨迹；用于队列探索页的单次请求。结果缓存在内存中。
        """
        cached = getattr(self, "_cohort_cache", None)
        if cached is not None:
            return cached

        def feature(observation, key: str) -> Optional[float]:
            if observation.missing_mask.get(key):
                return None
            value = observation.features.get(key)
            return float(value) if isinstance(value, (int, float)) else None

        def snapshot(observation) -> Dict[str, Any]:
            return {
                key: feature(observation, key)
                for key in ("tumor_size_cm", "afp", "albumin", "tbil", "tumor_number")
            }

        patients: List[Dict[str, Any]] = []
        stage_counts: Dict[str, int] = {}
        child_pugh_counts: Dict[str, int] = {}
        treatment_counts: Dict[str, int] = {}
        outcome_counts: Dict[str, int] = {}
        progression_days: List[int] = []

        for pid in self._id_to_idx:
            traj = self.get_trajectory(pid)
            patient = traj.patient
            visits = traj.visits
            if not visits:
                continue
            first = visits[0].observation
            last = visits[-1].observation
            bclc = getattr(patient.bclc_stage, "value", str(patient.bclc_stage))
            child_pugh = getattr(patient.child_pugh, "value", str(patient.child_pugh))
            sex = getattr(patient.sex, "value", str(patient.sex))

            treatments: Dict[str, int] = {}
            treatment_events: List[Dict[str, Any]] = []
            for visit in visits:
                for treatment in visit.treatments:
                    modality = getattr(treatment.modality, "value", str(treatment.modality))
                    treatments[modality] = treatments.get(modality, 0) + 1
                    treatment_events.append(
                        {
                            "day": int(treatment.days_from_index),
                            "modality": modality,
                            "dose_intensity": float(treatment.dose_intensity),
                        }
                    )

            outcomes = [
                {
                    "event": getattr(outcome.event, "value", str(outcome.event)),
                    "occurred": bool(outcome.occurred),
                    "days_from_index": int(outcome.days_from_index),
                }
                for outcome in traj.outcomes
            ]
            progression = next(
                (
                    outcome
                    for outcome in outcomes
                    if outcome["event"] == "progression" and outcome["occurred"]
                ),
                None,
            )
            if progression is not None:
                progression_days.append(progression["days_from_index"])

            stage_counts[bclc] = stage_counts.get(bclc, 0) + 1
            child_pugh_counts[child_pugh] = child_pugh_counts.get(child_pugh, 0) + 1
            for outcome in outcomes:
                event = outcome["event"]
                outcome_counts[event] = outcome_counts.get(event, 0) + 1
            for modality, count in treatments.items():
                treatment_counts[modality] = treatment_counts.get(modality, 0) + count

            patients.append(
                {
                    "patient_id": patient.patient_id,
                    "sex": sex,
                    "age_at_index": patient.age_at_index,
                    "bclc_stage": bclc,
                    "child_pugh": child_pugh,
                    "etiology": getattr(patient.etiology, "value", str(patient.etiology)),
                    "diagnosis_date": str(patient.diagnosis_date),
                    "n_visits": len(visits),
                    "follow_up_days": int(last.days_from_index - first.days_from_index),
                    "baseline": snapshot(first),
                    "last": snapshot(last),
                    "treatments": treatments,
                    "n_treatments": sum(treatments.values()),
                    "treatment_events": treatment_events,
                    "outcomes": outcomes,
                    "progression": progression,
                }
            )

        result = {
            "available": True,
            "n_patients": len(patients),
            "data_source": self.data_source,
            "research_only": True,
            "patients": patients,
            "aggregate": {
                "stage_counts": stage_counts,
                "child_pugh_counts": child_pugh_counts,
                "treatment_event_counts": treatment_counts,
                "outcome_event_counts": outcome_counts,
                "n_with_progression": len(progression_days),
                "progression_days": sorted(progression_days),
            },
            "note": (
                "合成队列的描述统计：结局/进展时间不是风险模型输出，"
                "不能当作个体风险预测或临床证据。"
            ),
        }
        self._cohort_cache = result
        return result

    def load_evaluation_report(
        self, report_path: Optional[str | Path] = None, report_name: Optional[str] = None
    ) -> Dict[str, Any]:
        """读取评估报告。

        - ``report_name``：reports/ 下的文件名（推荐，用于 /evaluations?report=...）；
        - ``report_path``：显式路径（测试/脚本用，保持向后兼容）。
        文件名会被安全解析，拒绝路径穿越；不存在时返回 available=false 而不是抛异常。
        """
        try:
            if report_path is not None:
                path = Path(report_path)
            elif report_name is not None:
                path = resolve_report_path(self.reports_dir, report_name)
            else:
                path = self.current_report_path()
        except (ValueError, FileNotFoundError) as exc:
            return {
                "research_only": True,
                "available": False,
                "message": str(exc),
            }
        if not path.exists():
            return {
                "research_only": True,
                "available": False,
                "message": f"未找到评估报告：{path}",
            }
        data = json.loads(path.read_text(encoding="utf-8"))
        data["available"] = True
        data["report_file"] = str(path)
        return data


_SERVICE: Optional[InferenceService] = None


def get_service() -> InferenceService:
    global _SERVICE
    if _SERVICE is None:
        _SERVICE = InferenceService()
    return _SERVICE


def reset_service() -> None:
    """测试用：强制下次重新加载。"""
    global _SERVICE
    _SERVICE = None
