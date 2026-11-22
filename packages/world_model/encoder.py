"""患者历史编码器：将逐步输入压成隐状态 / latent。"""

from __future__ import annotations

import torch
from torch import nn


class StateEncoder(nn.Module):
    """GRU Encoder。

    输入 x_in: (B, T, input_dim) — 已拼好的观测/掩码/Δt/治疗
    输出：
      h: (B, T, hidden_dim) 逐步隐状态
      z: (B, T, latent_dim) 逐步 latent
    """

    def __init__(self, input_dim: int, hidden_dim: int = 128, latent_dim: int = 128, dropout: float = 0.1):
        super().__init__()
        self.gru = nn.GRU(
            input_size=input_dim,
            hidden_size=hidden_dim,
            batch_first=True,
        )
        self.to_latent = nn.Sequential(
            nn.Linear(hidden_dim, latent_dim),
            nn.Tanh(),
            nn.Dropout(dropout),
        )

    def forward(self, x_in: torch.Tensor, lengths: torch.Tensor | None = None):
        # pack 可略加速变长；MVP 直接跑，pad 步靠 loss mask 忽略
        h_seq, _ = self.gru(x_in)
        z_seq = self.to_latent(h_seq)
        return h_seq, z_seq
