"""多步 rollout 辅助：加载 checkpoint 并对 batch 预测。"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict

import torch

from packages.data.dataset import FeatureNormalizer
from packages.world_model.model import HCCWorldModel


def load_model(checkpoint: str | Path, device: str | torch.device = "cpu"):
    ckpt = torch.load(checkpoint, map_location=device, weights_only=False)
    cfg = ckpt["config"]
    model = HCCWorldModel(
        hidden_dim=cfg["hidden_dim"],
        latent_dim=cfg["latent_dim"],
    )
    model.load_state_dict(ckpt["model"])
    model.to(device)
    model.eval()
    normalizer = FeatureNormalizer.from_state_dict(ckpt["normalizer"])
    return model, normalizer, ckpt


def rollout_batch(
    model: HCCWorldModel,
    normalizer: FeatureNormalizer,
    batch: Dict[str, Any],
    horizon: int = 6,
    context_len: int = 3,
) -> torch.Tensor:
    """返回原始特征空间的预测 (B, horizon, F)。"""
    b = dict(batch)
    b["features"] = normalizer.transform(batch["features"])
    pred_norm = model.rollout(b, horizon=horizon, context_len=context_len)
    return normalizer.inverse_transform(pred_norm)
