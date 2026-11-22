"""Latent → 临床特征（归一化空间的均值预测）。"""

from __future__ import annotations

import torch
from torch import nn


class FeatureDecoder(nn.Module):
    def __init__(self, latent_dim: int, feature_dim: int, hidden_dim: int = 128):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(latent_dim, hidden_dim),
            nn.SiLU(),
            nn.Linear(hidden_dim, feature_dim),
        )

    def forward(self, z: torch.Tensor) -> torch.Tensor:
        return self.net(z)
