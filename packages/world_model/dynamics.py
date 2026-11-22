"""概率/确定状态转移：z_t, a_t, Δt → z_{t+1}（MVP 先输出均值）。"""

from __future__ import annotations

import torch
from torch import nn


class LatentDynamics(nn.Module):
    """MLP 动力学（MVP）。

    后续可换成 probabilistic_gru：同时预测 mean/log_std 并做重参数采样。
    """

    def __init__(self, latent_dim: int, action_dim: int, hidden_dim: int = 128):
        super().__init__()
        # 输入：z + treatment + log1p(delta_t)
        in_dim = latent_dim + action_dim + 1
        self.net = nn.Sequential(
            nn.Linear(in_dim, hidden_dim),
            nn.SiLU(),
            nn.Linear(hidden_dim, hidden_dim),
            nn.SiLU(),
            nn.Linear(hidden_dim, latent_dim),
        )

    def forward(
        self,
        z: torch.Tensor,
        treatment: torch.Tensor,
        delta_t: torch.Tensor,
    ) -> torch.Tensor:
        """
        z: (B, T, D) 或 (B, D)
        treatment: (B, T, A) 或 (B, A)
        delta_t: (B, T) 或 (B,)  — 指向下一间隔的天数
        """
        if delta_t.ndim == z.ndim - 1:
            dt = torch.log1p(torch.clamp(delta_t, min=0.0)).unsqueeze(-1)
        else:
            dt = torch.log1p(torch.clamp(delta_t, min=0.0))
        inp = torch.cat([z, treatment, dt], dim=-1)
        return self.net(inp)
