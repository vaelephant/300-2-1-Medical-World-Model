"""HCC World Model：Encoder + Dynamics + 残差 Decoder。

核心改动（为了稳定超过 Persistence）：
1. 预测残差：x̂_{t+1} = x_t + Δ(z_{t+1})，未训练时 Δ≈0 → 等同 Persistence
2. 多步损失：额外对 t+2 做 free residual 累积，逼动力学学到可 rollout 的转移

训练仍在归一化特征空间；展示前 inverse_transform。
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
        multi_step: int = 2,
        multi_step_weight: float = 0.5,
        residual: bool = True,
    ) -> None:
        super().__init__()
        self.feature_dim = feature_dim
        self.treatment_dim = treatment_dim
        self.latent_dim = latent_dim
        self.multi_step = max(int(multi_step), 1)
        self.multi_step_weight = float(multi_step_weight)
        self.residual = bool(residual)
        self.input_dim = feature_dim + feature_dim + 1 + treatment_dim
        self.encoder = StateEncoder(self.input_dim, hidden_dim, latent_dim, dropout)
        self.dynamics = LatentDynamics(latent_dim, treatment_dim, hidden_dim)
        self.decoder = FeatureDecoder(latent_dim, feature_dim, hidden_dim, zero_init_out=True)

    def build_input(
        self,
        features: torch.Tensor,
        missing: torch.Tensor,
        delta_t: torch.Tensor,
        treatment: torch.Tensor,
    ) -> torch.Tensor:
        miss = missing.float()
        obs = features * (1.0 - miss)
        dt = torch.log1p(torch.clamp(delta_t, min=0.0)).unsqueeze(-1)
        return torch.cat([obs, miss, dt, treatment], dim=-1)

    def _decode_next(self, z_next: torch.Tensor, x_curr: torch.Tensor) -> torch.Tensor:
        delta = self.decoder(z_next)
        if self.residual:
            return x_curr + delta
        return delta

    def forward(self, batch: Dict[str, torch.Tensor]) -> Dict[str, Any]:
        features = batch["features"]
        missing = batch["missing"]
        delta_t = batch["delta_t"]
        treatment = batch["treatment"]
        pad_mask = batch["pad_mask"]

        x_in = self.build_input(features, missing, delta_t, treatment)
        _, z_seq = self.encoder(x_in)

        # ---- 一步：z_t, a_t, Δt_{t+1} → z_{t+1} → 残差预测 ----
        z_t = z_seq[:, :-1, :]
        a_t = treatment[:, :-1, :]
        dt_next = delta_t[:, 1:]
        z_next = self.dynamics(z_t, a_t, dt_next)
        x_curr = features[:, :-1, :]
        pred = self._decode_next(z_next, x_curr)

        target = features[:, 1:, :]
        miss_next = missing[:, 1:, :]
        step_valid = pad_mask[:, 1:] & pad_mask[:, :-1]
        valid = step_valid.unsqueeze(-1) & (~miss_next)
        loss_1 = masked_mse(pred, target, valid)

        loss = loss_1
        extra = {}

        # ---- 多步：从预测状态再滚一步（或若干步）----
        if self.multi_step >= 2 and features.shape[1] >= 3:
            # 用预测的 x̂_{t+1} 作为下一基准，动作/Δt 仍用教师序列
            z_s = z_next[:, :-1, :]
            a_s = treatment[:, 1:-1, :]
            dt_s = delta_t[:, 2:]
            z_s2 = self.dynamics(z_s, a_s, dt_s)
            pred2 = self._decode_next(z_s2, pred[:, :-1, :])
            target2 = features[:, 2:, :]
            miss2 = missing[:, 2:, :]
            step2 = pad_mask[:, 2:] & pad_mask[:, 1:-1] & pad_mask[:, :-2]
            valid2 = step2.unsqueeze(-1) & (~miss2)
            loss_2 = masked_mse(pred2, target2, valid2)
            loss = loss_1 + self.multi_step_weight * loss_2
            extra["loss_step2"] = loss_2.detach()

        return {
            "pred_features": pred,
            "z_seq": z_seq,
            "loss": loss,
            "loss_step1": loss_1.detach(),
            "valid_frac": valid.float().mean().detach(),
            **extra,
        }

    @torch.no_grad()
    def rollout(
        self,
        batch: Dict[str, torch.Tensor],
        horizon: int = 6,
        context_len: Optional[int] = None,
        future_treatment: Optional[torch.Tensor] = None,
    ) -> torch.Tensor:
        """自由 rollout，返回归一化空间预测 (B, horizon, F)。"""
        features = batch["features"]
        missing = batch["missing"]
        delta_t = batch["delta_t"]
        treatment = batch["treatment"]
        lengths = batch["lengths"]

        B = features.shape[0]
        if context_len is None:
            ctx = max(int(lengths.min().item()), 1)
        else:
            ctx = max(int(context_len), 1)

        feat_ctx = features[:, :ctx, :]
        miss_ctx = missing[:, :ctx, :]
        dt_ctx = delta_t[:, :ctx]
        treat_ctx = treatment[:, :ctx, :]
        x_in = self.build_input(feat_ctx, miss_ctx, dt_ctx, treat_ctx)
        _, z_seq = self.encoder(x_in)
        z = z_seq[:, -1, :]
        x = feat_ctx[:, -1, :]

        last_a = treat_ctx[:, -1, :]
        mean_dt = []
        for i in range(B):
            L = int(min(ctx, int(lengths[i].item())))
            dts = delta_t[i, 1:L]
            mean_dt.append(30.0 if dts.numel() == 0 else float(dts.mean().item()))
        dt_step = torch.tensor(mean_dt, device=features.device, dtype=features.dtype)

        preds = []
        if future_treatment is not None:
            expected = (B, horizon, treatment.shape[-1])
            if tuple(future_treatment.shape) != expected:
                raise ValueError(f"future_treatment shape must be {expected}")
            future_treatment = future_treatment.to(device=features.device, dtype=features.dtype)

        for step in range(horizon):
            action = last_a if future_treatment is None else future_treatment[:, step, :]
            z = self.dynamics(z, action, dt_step)
            x = self._decode_next(z, x)
            preds.append(x)
        return torch.stack(preds, dim=1)
