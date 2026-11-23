"""Latent → 特征残差（归一化空间）。

默认最后一层零初始化：未训练时 Δ≈0，预测 ≈ Persistence，
便于从「不输给基线」开始学改进。
"""

from __future__ import annotations

import torch
from torch import nn


class FeatureDecoder(nn.Module):
    def __init__(
        self,
        latent_dim: int,
        feature_dim: int,
        hidden_dim: int = 128,
        zero_init_out: bool = True,
    ):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(latent_dim, hidden_dim),
            nn.SiLU(),
            nn.Linear(hidden_dim, hidden_dim),
            nn.SiLU(),
            nn.Linear(hidden_dim, feature_dim),
        )
        if zero_init_out:
            last = self.net[-1]
            assert isinstance(last, nn.Linear)
            nn.init.zeros_(last.weight)
            nn.init.zeros_(last.bias)

    def forward(self, z: torch.Tensor) -> torch.Tensor:
        return self.net(z)
