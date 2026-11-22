"""对照基线（训练验收用）。

MVP 优先实现：
1. Persistence：x̂_{t+1} = x_t（最强「别输给常数预测」底线）
2. GRUBaseline：直接在特征空间做一步预测的浅 GRU（非 latent world model）

LightGBM 多输出基线放在 train_baselines CLI 里可选启用。
"""

from __future__ import annotations

from typing import Any, Dict, Optional, Tuple

import torch
from torch import nn
from torch.utils.data import DataLoader

from packages.data.dataset import FEATURE_DIM, TREATMENT_DIM
from packages.world_model.losses import masked_mse


def persistence_next_step(
    batch: Dict[str, torch.Tensor],
) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
    """返回 pred/target/valid，均为 (B, T-1, F)，特征为原始（或传入）空间。"""
    features = batch["features"]
    missing = batch["missing"]
    pad_mask = batch["pad_mask"]

    pred = features[:, :-1, :]
    target = features[:, 1:, :]
    miss_next = missing[:, 1:, :]
    step_valid = pad_mask[:, 1:] & pad_mask[:, :-1]
    valid = step_valid.unsqueeze(-1) & (~miss_next)
    return pred, target, valid


class GRUBaseline(nn.Module):
    """一步预测 GRU 基线：不经过显式 latent dynamics。"""

    def __init__(
        self,
        feature_dim: int = FEATURE_DIM,
        treatment_dim: int = TREATMENT_DIM,
        hidden_dim: int = 64,
    ) -> None:
        super().__init__()
        self.input_dim = feature_dim + feature_dim + 1 + treatment_dim
        self.gru = nn.GRU(self.input_dim, hidden_dim, batch_first=True)
        self.head = nn.Linear(hidden_dim, feature_dim)

    def build_input(self, batch: Dict[str, torch.Tensor]) -> torch.Tensor:
        features = batch["features"]
        miss = batch["missing"].float()
        obs = features * (1.0 - miss)
        dt = torch.log1p(torch.clamp(batch["delta_t"], min=0.0)).unsqueeze(-1)
        return torch.cat([obs, miss, dt, batch["treatment"]], dim=-1)

    def forward(self, batch: Dict[str, torch.Tensor]) -> Dict[str, Any]:
        x_in = self.build_input(batch)
        h, _ = self.gru(x_in)
        pred = self.head(h[:, :-1, :])
        target = batch["features"][:, 1:, :]
        miss_next = batch["missing"][:, 1:, :]
        step_valid = batch["pad_mask"][:, 1:] & batch["pad_mask"][:, :-1]
        valid = step_valid.unsqueeze(-1) & (~miss_next)
        loss = masked_mse(pred, target, valid)
        return {"pred_features": pred, "loss": loss, "valid": valid}


def train_gru_baseline(
    train_loader: DataLoader,
    val_loader: Optional[DataLoader],
    normalizer_fn,
    *,
    device: torch.device,
    epochs: int = 20,
    lr: float = 1e-3,
    hidden_dim: int = 64,
    patience: int = 5,
) -> Tuple[GRUBaseline, list]:
    """在归一化特征空间训练 GRU 基线，返回最佳模型与 history。"""
    model = GRUBaseline(hidden_dim=hidden_dim).to(device)
    optim = torch.optim.AdamW(model.parameters(), lr=lr)
    history = []
    best_state = None
    best_val = float("inf")
    stale = 0

    def epoch_loss(loader, train: bool) -> float:
        model.train(train)
        total, n = 0.0, 0
        for batch in loader:
            batch_t = {
                k: (v.to(device) if torch.is_tensor(v) else v) for k, v in batch.items()
            }
            batch_t = normalizer_fn(batch_t)
            if train:
                optim.zero_grad(set_to_none=True)
                out = model(batch_t)
                out["loss"].backward()
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                optim.step()
            else:
                with torch.no_grad():
                    out = model(batch_t)
            total += float(out["loss"].item())
            n += 1
        return total / max(n, 1)

    for ep in range(1, epochs + 1):
        tr = epoch_loss(train_loader, True)
        va = epoch_loss(val_loader, False) if val_loader is not None else tr
        history.append({"epoch": ep, "train_loss": tr, "val_loss": va})
        if va < best_val - 1e-5:
            best_val = va
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
            stale = 0
        else:
            stale += 1
            if stale >= patience:
                break
    if best_state is not None:
        model.load_state_dict(best_state)
    return model, history
