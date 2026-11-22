"""事件风险头（MVP 暂未接入训练；占位供后续 AUROC 实验）。"""

from __future__ import annotations

from torch import nn


class RiskHead(nn.Module):
    def __init__(self, latent_dim: int, n_events: int = 4):
        super().__init__()
        self.net = nn.Linear(latent_dim, n_events)

    def forward(self, z):
        return self.net(z)
