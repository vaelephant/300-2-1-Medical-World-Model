"""训练工具：masked normalizer、split、随机种子与指标边界的单元测试。"""

from __future__ import annotations

import random

import pytest
import torch

from packages.data.dataset import compute_feature_normalizer
from packages.data.schemas import CLINICAL_FEATURE_KEYS
from packages.data.splits import split_indices
from packages.training.evaluate import one_step_feature_metrics
from packages.training.train import set_global_seed

F = len(CLINICAL_FEATURE_KEYS)
ALT = CLINICAL_FEATURE_KEYS.index("alt")
AFP = CLINICAL_FEATURE_KEYS.index("afp")


def test_normalizer_ignores_missing_values() -> None:
    features = torch.zeros(2, 2, F)
    missing = torch.ones(2, 2, F, dtype=torch.bool)
    # 只观测 alt 两个值；其余特征全缺失。
    features[0, 0, ALT] = 2.0
    features[1, 1, ALT] = 4.0
    missing[0, 0, ALT] = False
    missing[1, 1, ALT] = False

    normalizer = compute_feature_normalizer(features, missing)

    assert normalizer.mean[ALT] == pytest.approx(3.0)
    assert normalizer.std[ALT] == pytest.approx(1.0)
    # 全缺失特征回退 mean=0 / std=1，不能变成 NaN。
    empty = [i for i in range(F) if i != ALT]
    for i in empty:
        assert normalizer.mean[i] == pytest.approx(0.0)
        assert normalizer.std[i] == pytest.approx(1.0)
    assert torch.isfinite(normalizer.mean).all()
    assert torch.isfinite(normalizer.std).all()


def test_normalizer_logs_afp() -> None:
    features = torch.zeros(1, 2, F)
    missing = torch.ones(1, 2, F, dtype=torch.bool)
    features[0, 0, AFP] = 0.0
    features[0, 1, AFP] = 3.0
    missing[0, :, AFP] = False

    normalizer = compute_feature_normalizer(features, missing)

    expected_mean = (torch.log1p(torch.tensor(0.0)) + torch.log1p(torch.tensor(3.0))) / 2
    assert normalizer.mean[AFP] == pytest.approx(float(expected_mean))


def test_split_indices_disjoint_and_deterministic() -> None:
    train, val, test = split_indices(100, seed=7)
    assert len(train) == 70
    assert len(val) == 15
    assert len(test) == 15
    assert len(set(train + val + test)) == 100
    assert not (set(train) & set(val) or set(train) & set(test) or set(val) & set(test))

    again = split_indices(100, seed=7)
    assert (train, val, test) == again
    other = split_indices(100, seed=8)
    assert other != (train, val, test)


@pytest.mark.parametrize(
    "kwargs",
    [
        {"n": 0},
        {"n": 10, "train_ratio": 0.0},
        {"n": 10, "val_ratio": 1.0},
        {"n": 10, "train_ratio": 0.9, "val_ratio": 0.2},
    ],
)
def test_split_indices_rejects_invalid_ratios(kwargs) -> None:
    with pytest.raises(ValueError):
        split_indices(**kwargs)


def test_set_global_seed_is_reproducible() -> None:
    set_global_seed(123)
    a = (random.random(), torch.rand(4))
    set_global_seed(123)
    b = (random.random(), torch.rand(4))
    assert a[0] == b[0]
    assert torch.equal(a[1], b[1])


def test_metrics_exclude_all_missing_features_from_macro() -> None:
    pred = torch.zeros(1, 1, F)
    target = torch.zeros(1, 1, F)
    target[0, 0, ALT] = 2.0
    valid = torch.zeros(1, 1, F, dtype=torch.bool)
    valid[0, 0, ALT] = True

    metrics = one_step_feature_metrics(pred, target, valid)

    assert metrics["mae_macro"] == pytest.approx(2.0)
    assert metrics["mae_ex_afp"] == pytest.approx(2.0)
    assert metrics["n_valid_per_feature"][CLINICAL_FEATURE_KEYS[ALT]] == 1
    assert metrics["n_valid_per_feature"][CLINICAL_FEATURE_KEYS[AFP]] == 0
