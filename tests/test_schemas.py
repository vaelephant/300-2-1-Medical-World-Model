"""D02：HCC 患者状态 Schema 校验测试。

验收：合法样本可通过；非法字段/乱序时间/越界值应被拒绝。
"""

from __future__ import annotations

import json
from datetime import date

import pytest
from pydantic import ValidationError

from packages.data.schemas import (
    CLINICAL_FEATURE_KEYS,
    BCLCStage,
    ChildPughClass,
    Observation,
    Outcome,
    OutcomeEvent,
    Patient,
    PatientTrajectory,
    Sex,
    Treatment,
    TreatmentModality,
    Visit,
)


def _minimal_patient(**kwargs) -> Patient:
    base = dict(
        patient_id="P0001",
        sex=Sex.MALE,
        age_at_index=58,
        diagnosis_date=date(2024, 1, 15),
        bclc_stage=BCLCStage.B,
        child_pugh=ChildPughClass.A,
        etiology="HBV",
        data_source="synthetic",
        research_only=True,
    )
    base.update(kwargs)
    return Patient(**base)


def _obs(day_offset: int = 0, **kwargs) -> Observation:
    features = {
        "afp": 120.0,
        "alt": 45.0,
        "ast": 50.0,
        "tbil": 18.0,
        "albumin": 38.0,
        "inr": 1.1,
        "platelet": 150.0,
        "creatinine": 0.9,
        "tumor_size_cm": 3.2,
        "tumor_number": 2.0,
    }
    features.update(kwargs.pop("features", {}))
    base = dict(
        visit_index=0,
        days_from_index=day_offset,
        delta_t_days=0.0 if day_offset == 0 else float(day_offset),
        features=features,
        missing_mask={k: False for k in CLINICAL_FEATURE_KEYS},
    )
    base.update(kwargs)
    return Observation(**base)


def test_patient_accepts_valid_baseline():
    p = _minimal_patient()
    assert p.patient_id == "P0001"
    assert p.research_only is True
    assert p.data_source == "synthetic"


def test_patient_rejects_negative_age():
    with pytest.raises(ValidationError):
        _minimal_patient(age_at_index=-1)


def test_observation_feature_keys_and_mask_aligned():
    obs = _obs()
    assert set(obs.features) == set(CLINICAL_FEATURE_KEYS)
    assert set(obs.missing_mask) == set(CLINICAL_FEATURE_KEYS)


def test_observation_rejects_unknown_feature_key():
    with pytest.raises(ValidationError):
        _obs(features={"afp": 1.0, "not_a_real_lab": 9.0})


def test_treatment_and_outcome_enums():
    t = Treatment(
        days_from_index=30,
        modality=TreatmentModality.TACE,
        dose_intensity=0.8,
        notes="cycle-1",
    )
    o = Outcome(
        days_from_index=90,
        event=OutcomeEvent.PROGRESSION,
        occurred=True,
    )
    assert t.modality == TreatmentModality.TACE
    assert o.event == OutcomeEvent.PROGRESSION


def test_visit_bundles_state_tuple_components():
    """s_t = (x_t, m_t, a_t, Δt) 在 Visit 层组装。"""
    visit = Visit(
        observation=_obs(0),
        treatments=[],
        delta_t_days=0.0,
    )
    assert visit.observation.features["afp"] == 120.0
    assert visit.delta_t_days == 0.0


def test_trajectory_requires_non_decreasing_time():
    v0 = Visit(observation=_obs(0), treatments=[], delta_t_days=0.0)
    v1 = Visit(
        observation=_obs(30, visit_index=1, delta_t_days=30.0),
        treatments=[
            Treatment(
                days_from_index=30,
                modality=TreatmentModality.SYSTEMIC,
                dose_intensity=1.0,
            )
        ],
        delta_t_days=30.0,
    )
    traj = PatientTrajectory(
        patient=_minimal_patient(),
        visits=[v0, v1],
        outcomes=[],
    )
    assert len(traj.visits) == 2


def test_trajectory_rejects_time_going_backwards():
    # Δt 本身非负合法，但 days_from_index 从 30 回到 10 → 轨迹层应拒绝
    v0 = Visit(observation=_obs(30), treatments=[], delta_t_days=30.0)
    v1 = Visit(
        observation=_obs(10, visit_index=1, delta_t_days=10.0),
        treatments=[],
        delta_t_days=10.0,
    )
    with pytest.raises(ValidationError):
        PatientTrajectory(patient=_minimal_patient(), visits=[v0, v1], outcomes=[])


def test_trajectory_json_roundtrip():
    traj = PatientTrajectory(
        patient=_minimal_patient(),
        visits=[Visit(observation=_obs(0), treatments=[], delta_t_days=0.0)],
        outcomes=[
            Outcome(
                days_from_index=180,
                event=OutcomeEvent.NONE,
                occurred=False,
            )
        ],
    )
    payload = json.loads(traj.model_dump_json())
    restored = PatientTrajectory.model_validate(payload)
    assert restored.patient.patient_id == traj.patient.patient_id
    assert restored.visits[0].observation.features["albumin"] == 38.0
