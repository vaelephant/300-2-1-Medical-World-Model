"""训练损失：掩码 MSE（忽略 padding 与缺失标签）。"""

from __future__ import annotations

import torch


def masked_mse(
    pred: torch.Tensor,
    target: torch.Tensor,
    valid: torch.Tensor,
    eps: float = 1e-8,
    balanced: bool = True,
) -> torch.Tensor:
    """
    pred/target: (B, T, F)
    valid: (B, T, F) True=计入损失

    balanced=True（默认）：先按特征算 MSE，再对特征取平均。
    避免「有效点数量多的特征」或训练动态中某维主导梯度。
    """
    valid_f = valid.float()
    diff2 = (pred - target) ** 2 * valid_f
    if balanced:
        per_f = diff2.sum(dim=(0, 1)) / valid_f.sum(dim=(0, 1)).clamp_min(eps)
        return per_f.mean()
    denom = valid_f.sum().clamp_min(eps)
    return diff2.sum() / denom
