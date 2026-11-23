"""轨迹 Dataset：JSON 合成样本 → PyTorch Tensor。

MVP 说明：
- 直接读 artifacts/synthetic/*.json（与 generate_data.py 输出对齐）
- 后续可换成 Parquet；接口保持 collate 后的 batch 字典不变
- missing=True 表示该特征缺失；损失里应对观测位加权
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

import torch
from torch.nn.utils.rnn import pad_sequence

from packages.data.schemas import CLINICAL_FEATURE_KEYS, PatientTrajectory, TreatmentModality

FEATURE_DIM = len(CLINICAL_FEATURE_KEYS)
TREATMENT_MODALITIES: tuple[str, ...] = tuple(m.value for m in TreatmentModality)
TREATMENT_DIM = len(TREATMENT_MODALITIES) + 1  # one-hot + dose_intensity


class FeatureNormalizer:
    """按特征维做 z-score；对 afp 先 log1p 再标准化（重尾）。"""

    def __init__(self, mean: torch.Tensor, std: torch.Tensor, log_afp: bool = True) -> None:
        self.mean = mean.float()
        self.std = torch.clamp(std.float(), min=1e-6)
        self.log_afp = log_afp
        self._afp_index = CLINICAL_FEATURE_KEYS.index("afp")

    def _maybe_log(self, x: torch.Tensor) -> torch.Tensor:
        if not self.log_afp:
            return x
        y = x.clone()
        y[..., self._afp_index] = torch.log1p(torch.clamp(y[..., self._afp_index], min=0.0))
        return y

    def _maybe_expm1(self, x: torch.Tensor) -> torch.Tensor:
        if not self.log_afp:
            return x
        y = x.clone()
        y[..., self._afp_index] = torch.expm1(y[..., self._afp_index])
        return y

    def transform(self, x: torch.Tensor) -> torch.Tensor:
        mean = self.mean.to(device=x.device, dtype=x.dtype)
        std = self.std.to(device=x.device, dtype=x.dtype)
        return (self._maybe_log(x) - mean) / std

    def inverse_transform(self, x: torch.Tensor) -> torch.Tensor:
        mean = self.mean.to(device=x.device, dtype=x.dtype)
        std = self.std.to(device=x.device, dtype=x.dtype)
        return self._maybe_expm1(x * std + mean)

    def state_dict(self) -> Dict[str, Any]:
        return {
            "mean": self.mean.cpu(),
            "std": self.std.cpu(),
            "log_afp": self.log_afp,
        }

    @classmethod
    def from_state_dict(cls, state: Dict[str, Any]) -> FeatureNormalizer:
        return cls(mean=state["mean"], std=state["std"], log_afp=bool(state.get("log_afp", True)))


def compute_feature_normalizer(
    features: torch.Tensor,
    missing: Optional[torch.Tensor] = None,
    *,
    log_afp: bool = True,
) -> FeatureNormalizer:
    """按特征维计算 z-score 统计量，**忽略缺失位与 padding 位**。

    ``features``: (N, T, F)；``missing``: 同 shape 的 bool，True 表示缺失。
    逐行统计会把缺失位默认的 0 混入 mean/std，导致归一化偏置；这里改为
    逐特征 masked mean/std，某个特征全缺失时回退 mean=0 / std=1。
    """
    if features.ndim != 3:
        raise ValueError(f"features 必须是 (N, T, F)，实际 shape={tuple(features.shape)}")
    values = features.float()
    if missing is None:
        observed = torch.ones_like(values, dtype=torch.bool)
    else:
        if missing.shape != features.shape:
            raise ValueError(
                f"missing shape 必须与 features 一致：{tuple(missing.shape)} vs {tuple(features.shape)}"
            )
        observed = ~missing.bool()

    tmp = FeatureNormalizer(
        mean=torch.zeros(values.shape[-1]),
        std=torch.ones(values.shape[-1]),
        log_afp=log_afp,
    )
    logged = tmp._maybe_log(values)
    mask = observed.float()
    counts = mask.sum(dim=(0, 1))
    safe_counts = counts.clamp_min(1.0)
    mean = (logged * mask).sum(dim=(0, 1)) / safe_counts
    variance = (((logged - mean) ** 2) * mask).sum(dim=(0, 1)) / safe_counts
    std = torch.sqrt(variance)

    # 没有任何有效观测的特征：mean=0 / std=1，避免 0 除与 NaN。
    mean = torch.where(counts > 0, mean, torch.zeros_like(mean))
    std = torch.where(counts > 0, std.clamp_min(1e-6), torch.ones_like(std))
    return FeatureNormalizer(mean=mean, std=std, log_afp=log_afp)


def _treatment_vector(treatments: Sequence[Any]) -> torch.Tensor:
    """将一次访视的治疗列表压成固定向量：one-hot(主治疗) + dose。"""
    vec = torch.zeros(TREATMENT_DIM, dtype=torch.float32)
    if not treatments:
        # NONE
        none_idx = TREATMENT_MODALITIES.index(TreatmentModality.NONE.value)
        vec[none_idx] = 1.0
        return vec
    # 取第一条（MVP）；多治疗时可改为求和再归一
    t = treatments[0]
    modality = t.modality.value if hasattr(t.modality, "value") else str(t.modality)
    if modality in TREATMENT_MODALITIES:
        vec[TREATMENT_MODALITIES.index(modality)] = 1.0
    dose = float(getattr(t, "dose_intensity", 1.0))
    vec[-1] = dose
    return vec


def trajectory_to_tensors(traj: PatientTrajectory, max_visits: Optional[int] = None) -> Dict[str, torch.Tensor]:
    visits = traj.visits
    if max_visits is not None:
        visits = visits[:max_visits]
    T = len(visits)
    features = torch.zeros(T, FEATURE_DIM, dtype=torch.float32)
    missing = torch.zeros(T, FEATURE_DIM, dtype=torch.bool)
    delta_t = torch.zeros(T, dtype=torch.float32)
    treatment = torch.zeros(T, TREATMENT_DIM, dtype=torch.float32)

    for i, visit in enumerate(visits):
        obs = visit.observation
        for j, key in enumerate(CLINICAL_FEATURE_KEYS):
            features[i, j] = float(obs.features[key])
            missing[i, j] = bool(obs.missing_mask[key])
        delta_t[i] = float(visit.delta_t_days)
        treatment[i] = _treatment_vector(visit.treatments)

    return {
        "features": features,
        "missing": missing,
        "delta_t": delta_t,
        "treatment": treatment,
        "length": torch.tensor(T, dtype=torch.long),
        "patient_id": traj.patient.patient_id,
    }


class TrajectoryDataset(torch.utils.data.Dataset):
    """从目录加载 PatientTrajectory JSON。"""

    def __init__(
        self,
        root: str | Path,
        max_patients: Optional[int] = None,
        max_visits: int = 24,
        patient_ids: Optional[Sequence[str]] = None,
    ) -> None:
        self.root = Path(root)
        self.max_visits = max_visits
        paths = sorted(self.root.glob("SYN*.json"))
        if patient_ids is not None:
            allow = set(patient_ids)
            paths = [p for p in paths if p.stem in allow]
        if max_patients is not None:
            paths = paths[: int(max_patients)]
        if not paths:
            raise FileNotFoundError(f"未找到轨迹 JSON：{self.root}/SYN*.json")
        self.paths = paths
        self.normalizer: Optional[FeatureNormalizer] = None
        self._cache: List[Dict[str, Any]] = []
        for p in self.paths:
            raw = json.loads(p.read_text(encoding="utf-8"))
            traj = PatientTrajectory.model_validate(raw)
            self._cache.append(trajectory_to_tensors(traj, max_visits=self.max_visits))

    def __len__(self) -> int:
        return len(self._cache)

    def __getitem__(self, idx: int) -> Dict[str, Any]:
        return self._cache[idx]

    def fit_normalizer(self) -> Dict[str, torch.Tensor]:
        """用当前子集中「非缺失」值估计 mean/std（在 log-afp 空间）。

        逐个特征忽略缺失位与 padding 位；不再把缺失位默认的 0 计入统计。
        """
        batch = collate_trajectories(self._cache)
        missing = batch["missing"] | (~batch["pad_mask"]).unsqueeze(-1)
        self.normalizer = compute_feature_normalizer(
            batch["features"], missing, log_afp=True
        )
        return {"mean": self.normalizer.mean, "std": self.normalizer.std}

    def apply_normalizer_to_batch(self, batch: Dict[str, torch.Tensor]) -> Dict[str, torch.Tensor]:
        if self.normalizer is None:
            raise RuntimeError("请先 fit_normalizer() 或加载 checkpoint 中的 normalizer")
        out = dict(batch)
        out["features"] = self.normalizer.transform(batch["features"])
        return out


def collate_trajectories(items: Sequence[Dict[str, Any]]) -> Dict[str, torch.Tensor]:
    """变长轨迹 pad 到 batch 内最大 T。pad_mask=True 表示有效步。"""
    lengths = torch.stack([it["length"] for it in items], dim=0)
    features = pad_sequence([it["features"] for it in items], batch_first=True)
    missing = pad_sequence([it["missing"].float() for it in items], batch_first=True).bool()
    delta_t = pad_sequence([it["delta_t"] for it in items], batch_first=True)
    treatment = pad_sequence([it["treatment"] for it in items], batch_first=True)

    B, T, _ = features.shape
    pad_mask = torch.zeros(B, T, dtype=torch.bool)
    for i, L in enumerate(lengths.tolist()):
        pad_mask[i, : int(L)] = True

    return {
        "features": features,
        "missing": missing,
        "delta_t": delta_t,
        "treatment": treatment,
        "lengths": lengths,
        "pad_mask": pad_mask,
        "patient_ids": [it["patient_id"] for it in items],
    }
