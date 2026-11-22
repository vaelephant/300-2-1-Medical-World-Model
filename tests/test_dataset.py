"""Dataset：JSON 轨迹 → 填充后的 Tensor batch。"""

from __future__ import annotations

from pathlib import Path

import torch

from packages.data.dataset import TrajectoryDataset, collate_trajectories
from packages.data.schemas import CLINICAL_FEATURE_KEYS


ROOT = Path(__file__).resolve().parents[1]
SYN_DIR = ROOT / "artifacts" / "synthetic"


def test_dataset_loads_and_collates():
    assert SYN_DIR.exists(), "需要先生成 artifacts/synthetic"
    ds = TrajectoryDataset(SYN_DIR, max_patients=8, max_visits=12)
    assert len(ds) == 8
    item = ds[0]
    F = len(CLINICAL_FEATURE_KEYS)
    assert item["features"].shape[1] == F
    assert item["missing"].shape == item["features"].shape

    batch = collate_trajectories([ds[i] for i in range(4)])
    assert batch["features"].shape[0] == 4
    assert batch["features"].ndim == 3
    assert batch["lengths"].tolist() == [int(x) for x in batch["lengths"]]
    # padding 后时间维一致
    T = batch["features"].shape[1]
    assert batch["pad_mask"].shape == (4, T)


def test_normalizer_roundtrip_shape():
    ds = TrajectoryDataset(SYN_DIR, max_patients=16, max_visits=12)
    stats = ds.fit_normalizer()
    assert stats["mean"].shape[0] == len(CLINICAL_FEATURE_KEYS)
    # afp 走 log1p，需非负才可严格 roundtrip
    x = torch.rand(2, 3, len(CLINICAL_FEATURE_KEYS)) * 10 + 0.1
    y = ds.normalizer.transform(x)
    z = ds.normalizer.inverse_transform(y)
    assert torch.allclose(x, z, atol=1e-4)
