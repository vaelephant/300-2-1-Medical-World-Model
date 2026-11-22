"""D03：合成患者轨迹生成器测试。

验收重点：固定种子可复现；轨迹通过 Schema；时间单调。
"""

from __future__ import annotations

import pytest

from packages.data.schemas import CLINICAL_FEATURE_KEYS, PatientTrajectory
from packages.data.synthetic_generator import SyntheticGenerator, generate_cohort


def test_generate_one_trajectory_validates_schema():
    gen = SyntheticGenerator(seed=42)
    traj = gen.generate_one(patient_index=0)
    assert isinstance(traj, PatientTrajectory)
    # 再次走 Schema（generate 内部已 validate，这里防回归）
    PatientTrajectory.model_validate(traj.model_dump())
    assert traj.patient.data_source == "synthetic"
    assert traj.patient.research_only is True
    assert len(traj.visits) >= 2


def test_fixed_seed_is_reproducible():
    a = generate_cohort(n_patients=20, seed=123)
    b = generate_cohort(n_patients=20, seed=123)
    assert [t.model_dump() for t in a] == [t.model_dump() for t in b]


def test_different_seeds_differ():
    a = generate_cohort(n_patients=5, seed=1)
    b = generate_cohort(n_patients=5, seed=2)
    assert [t.model_dump() for t in a] != [t.model_dump() for t in b]


def test_time_non_decreasing_across_visits():
    trajs = generate_cohort(n_patients=50, seed=7)
    for traj in trajs:
        days = [v.observation.days_from_index for v in traj.visits]
        assert days == sorted(days)
        for v in traj.visits:
            assert set(v.observation.features) == set(CLINICAL_FEATURE_KEYS)


def test_d03_acceptance_generate_1000(tmp_path):
    """D03 验收：1,000 条可复现轨迹（不落盘也可）。"""
    trajs = generate_cohort(n_patients=1000, seed=42, max_visits=12)
    assert len(trajs) == 1000
    assert all(isinstance(t, PatientTrajectory) for t in trajs)
    # 抽样检查 patient_id 唯一
    ids = [t.patient.patient_id for t in trajs]
    assert len(ids) == len(set(ids))
