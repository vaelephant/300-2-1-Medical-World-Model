"""HCC World Model MVP：Encoder + Dynamics + Decoder。

训练（teacher forcing）：
  对 t = 0..T-2：
    用前缀编码得到 z_t
    z_{t+1} = Dynamics(z_t, a_t, Δt_{t+1})
    x̂_{t+1} = Decoder(z_{t+1})
    与真实 x_{t+1} 做掩码 MSE

推理 rollout：
  用 context 编码出最后 z，再在 latent 空间自由多步转移并解码。

注意：输出默认在**归一化特征空间**；展示前需 inverse_transform。
"""

from __future__ import annotations

from typing import Any, Dict, Optional

import torch
from torch import nn

from packages.data.dataset import FEATURE_DIM, TREATMENT_DIM
from packages.world_model.decoder import FeatureDecoder
from packages.world_model.dynamics import LatentDynamics
from packages.world_model.encoder import StateEncoder
from packages.world_model.losses import masked_mse


class HCCWorldModel(nn.Module):
    def __init__(
        self,
        feature_dim: int = FEATURE_DIM,
        treatment_dim: int = TREATMENT_DIM,
        hidden_dim: int = 128,
        latent_dim: int = 128,
        dropout: float = 0.1,
    ) -> None:
        super().__init__()
        self.feature_dim = feature_dim
        self.treatment_dim = treatment_dim
        self.latent_dim = latent_dim
        # 输入 = 特征 + 缺失指示 + log1p(delta_t) + 治疗向量
        self.input_dim = feature_dim + feature_dim + 1 + treatment_dim
        self.encoder = StateEncoder(self.input_dim, hidden_dim, latent_dim, dropout)
        self.dynamics = LatentDynamics(latent_dim, treatment_dim, hidden_dim)
        self.decoder = FeatureDecoder(latent_dim, feature_dim, hidden_dim)

    def build_input(
        self,
        features: torch.Tensor,
        missing: torch.Tensor,
        delta_t: torch.Tensor,
        treatment: torch.Tensor,
    ) -> torch.Tensor:
        """拼逐步编码器输入；缺失特征置 0，并把 missing 本身作为通道。"""
        miss = missing.float()
        obs = features * (1.0 - miss)
        dt = torch.log1p(torch.clamp(delta_t, min=0.0)).unsqueeze(-1)
        return torch.cat([obs, miss, dt, treatment], dim=-1)

    def forward(self, batch: Dict[str, torch.Tensor]) -> Dict[str, Any]:
        features = batch["features"]
        missing = batch["missing"]
        delta_t = batch["delta_t"]
        treatment = batch["treatment"]
        pad_mask = batch["pad_mask"]

        x_in = self.build_input(features, missing, delta_t, treatment)
        _, z_seq = self.encoder(x_in)

        # 用 z_t + a_t + Δt_{t+1} 预测 z_{t+1}
        z_t = z_seq[:, :-1, :]
        a_t = treatment[:, :-1, :]
        dt_next = delta_t[:, 1:]
        z_next = self.dynamics(z_t, a_t, dt_next)
        pred = self.decoder(z_next)  # (B, T-1, F)

        target = features[:, 1:, :]
        miss_next = missing[:, 1:, :]
        # 有效：下一步非 pad，且该特征非缺失
        step_valid = pad_mask[:, 1:] & pad_mask[:, :-1]
        valid = step_valid.unsqueeze(-1) & (~miss_next)

        loss = masked_mse(pred, target, valid)
        return {
            "pred_features": pred,
            "z_seq": z_seq,
            "loss": loss,
            "valid_frac": valid.float().mean().detach(),
        }

    @torch.no_grad()
    def rollout(
        self,
        batch: Dict[str, torch.Tensor],
        horizon: int = 6,
        context_len: Optional[int] = None,
    ) -> torch.Tensor:
        """自由 rollout，返回归一化空间预测 (B, horizon, F)。"""
        features = batch["features"]
        missing = batch["missing"]
        delta_t = batch["delta_t"]
        treatment = batch["treatment"]
        pad_mask = batch["pad_mask"]
        lengths = batch["lengths"]

        B = features.shape[0]
        # context：用前 context_len 步，或整段有效历史
        if context_len is None:
            ctx = int(lengths.min().item())
            ctx = max(ctx, 1)
        else:
            ctx = max(int(context_len), 1)

        feat_ctx = features[:, :ctx, :]
        miss_ctx = missing[:, :ctx, :]
        dt_ctx = delta_t[:, :ctx]
        treat_ctx = treatment[:, :ctx, :]
        x_in = self.build_input(feat_ctx, miss_ctx, dt_ctx, treat_ctx)
        _, z_seq = self.encoder(x_in)
        z = z_seq[:, -1, :]  # (B, D)

        # 后续动作：重复最后一次治疗；Δt 用上下文平均间隔（至少 30 天）
        last_a = treat_ctx[:, -1, :]
        mean_dt = []
        for i in range(B):
            L = int(min(ctx, int(lengths[i].item())))
            dts = delta_t[i, 1:L]
            if dts.numel() == 0:
                mean_dt.append(30.0)
            else:
                mean_dt.append(float(dts.mean().item()))
        dt_step = torch.tensor(mean_dt, device=features.device, dtype=features.dtype)

        preds = []
        for _ in range(horizon):
            z = self.dynamics(z, last_a, dt_step)
            x_hat = self.decoder(z)
            preds.append(x_hat)
        return torch.stack(preds, dim=1)
