"""最小 HCC 世界模型：shape、一步反传、rollout 有限。"""

from __future__ import annotations

from pathlib import Path

import torch

from packages.data.dataset import TrajectoryDataset, collate_trajectories
from packages.data.schemas import CLINICAL_FEATURE_KEYS
from packages.world_model.model import HCCWorldModel


ROOT = Path(__file__).resolve().parents[1]
SYN_DIR = ROOT / "artifacts" / "synthetic"
F = len(CLINICAL_FEATURE_KEYS)


def _batch(n: int = 4):
    ds = TrajectoryDataset(SYN_DIR, max_patients=16, max_visits=10)
    ds.fit_normalizer()
    return collate_trajectories([ds[i] for i in range(n)]), ds


def test_forward_and_backward():
    batch, ds = _batch()
    # 训练时用归一化特征
    batch = ds.apply_normalizer_to_batch(batch)
    model = HCCWorldModel(feature_dim=F, hidden_dim=32, latent_dim=32)
    out = model(batch)
    assert out["pred_features"].shape[0] == batch["features"].shape[0]
    assert out["loss"].ndim == 0
    out["loss"].backward()
    grads = [p.grad is not None for p in model.parameters() if p.requires_grad]
    assert any(grads)


def test_rollout_finite():
    batch, ds = _batch(2)
    batch = ds.apply_normalizer_to_batch(batch)
    model = HCCWorldModel(feature_dim=F, hidden_dim=32, latent_dim=32)
    model.eval()
    with torch.no_grad():
        traj = model.rollout(batch, horizon=5, context_len=2)
    assert traj.shape[1] == 5
    assert torch.isfinite(traj).all()


def test_untrained_residual_near_persistence():
    """零初始化残差：未训练预测应接近 x_t（Persistence）。"""
    batch, ds = _batch(4)
    batch = ds.apply_normalizer_to_batch(batch)
    model = HCCWorldModel(feature_dim=F, hidden_dim=32, latent_dim=32, residual=True)
    model.eval()
    with torch.no_grad():
        pred = model(batch)["pred_features"]
    persist = batch["features"][:, :-1, :]
    # 允许极小数值差（dynamics 非零但 decoder 输出被零初始化）
    assert torch.allclose(pred, persist, atol=1e-5)
