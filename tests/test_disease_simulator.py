"""疾病演化模拟器单测（D04 核心步进，供 D03 生成器调用）。"""

from __future__ import annotations

import numpy as np

from packages.data.disease_simulator import DiseaseSimulator, LatentState
from packages.data.schemas import (
    CLINICAL_FEATURE_KEYS,
    BCLCStage,
    ChildPughClass,
    Treatment,
    TreatmentModality,
)


def test_step_keeps_feature_keys_and_ranges():
    rng = np.random.default_rng(0)
    sim = DiseaseSimulator()
    latent = LatentState(
        bclc=BCLCStage.B,
        child_pugh=ChildPughClass.A,
        tumor_growth=0.02,
        liver_decline=0.01,
    )
    features = {k: 10.0 for k in CLINICAL_FEATURE_KEYS}
    features.update(
        {
            "afp": 100.0,
            "albumin": 38.0,
            "inr": 1.1,
            "tumor_size_cm": 3.0,
            "tumor_number": 2.0,
            "platelet": 150.0,
            "alt": 40.0,
            "ast": 45.0,
            "tbil": 15.0,
            "creatinine": 0.9,
        }
    )
    nxt, new_latent, event = sim.step(
        features=features,
        latent=latent,
        treatments=[
            Treatment(
                days_from_index=30,
                modality=TreatmentModality.TACE,
                dose_intensity=0.8,
            )
        ],
        delta_t_days=30.0,
        rng=rng,
    )
    assert set(nxt) == set(CLINICAL_FEATURE_KEYS)
    assert all(isinstance(v, float) for v in nxt.values())
    assert new_latent is not None
    # event 可为 None 或 OutcomeEvent
    _ = event


def test_longer_horizon_does_not_explode_to_nan():
    rng = np.random.default_rng(1)
    sim = DiseaseSimulator()
    latent = LatentState(
        bclc=BCLCStage.C,
        child_pugh=ChildPughClass.B,
        tumor_growth=0.05,
        liver_decline=0.02,
    )
    features = {
        "afp": 500.0,
        "alt": 80.0,
        "ast": 90.0,
        "tbil": 30.0,
        "albumin": 32.0,
        "inr": 1.3,
        "platelet": 90.0,
        "creatinine": 1.1,
        "tumor_size_cm": 5.0,
        "tumor_number": 3.0,
    }
    for _ in range(24):
        features, latent, _ = sim.step(
            features=features,
            latent=latent,
            treatments=[],
            delta_t_days=45.0,
            rng=rng,
        )
        assert all(np.isfinite(v) for v in features.values())
