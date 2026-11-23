"""患者级 train/val/test 切分，防止同一患者跨 split 泄漏。

集中在这里，训练（``packages/training/train.py``）与评估
（``packages/training/evaluate.py``）共用同一套语义。
"""

from __future__ import annotations

from typing import List, Tuple

import torch


def split_indices(
    n: int,
    train_ratio: float = 0.7,
    val_ratio: float = 0.15,
    seed: int = 42,
) -> Tuple[List[int], List[int], List[int]]:
    """返回 (train_idx, val_idx, test_idx)，三者互斥且覆盖全部样本。

    - 使用独立的 ``torch.Generator``，不依赖全局随机状态；
    - 比例校验失败时直接报错，避免静默产生空 split / 泄漏。
    """
    if not isinstance(n, int) or n < 1:
        raise ValueError(f"n 必须是正整数，实际 {n!r}")
    if not 0.0 < train_ratio < 1.0:
        raise ValueError(f"train_ratio 必须在 (0, 1) 内，实际 {train_ratio!r}")
    if not 0.0 <= val_ratio < 1.0:
        raise ValueError(f"val_ratio 必须在 [0, 1) 内，实际 {val_ratio!r}")
    if train_ratio + val_ratio >= 1.0:
        raise ValueError(
            f"train_ratio + val_ratio 必须 < 1，实际 {train_ratio + val_ratio:.3f}"
        )

    generator = torch.Generator().manual_seed(int(seed))
    permutation = torch.randperm(n, generator=generator).tolist()
    n_train = int(n * train_ratio)
    n_val = int(n * val_ratio)
    train_idx = permutation[:n_train]
    val_idx = permutation[n_train : n_train + n_val]
    test_idx = permutation[n_train + n_val :]
    return train_idx, val_idx, test_idx
