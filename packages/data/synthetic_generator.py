"""合成患者轨迹生成器（D03）。

输入：随机种子、患者数量 → 输出：List[PatientTrajectory]

验收：
- 固定种子结果一致
- 轨迹通过 packages.data.schemas 校验
- 可生成 ≥1000 条完整轨迹

流水线：
1. 采样患者基线（年龄、性别、BCLC、Child-Pugh、病因）
2. 采样初始临床特征与潜在动力学参数
3. 按访视间隔循环：抽样治疗 → DiseaseSimulator.step → 写 Visit
4. 汇总 Outcome；整条轨迹交给 PatientTrajectory 做最终校验

说明：本模块只编排「造人」；真正的状态转移在 disease_simulator.py。
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Dict, List

import numpy as np

from packages.data.disease_simulator import DiseaseSimulator, LatentState, clip_features
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

# 基线分布（合成先验，不是流行病学真实患病率）
_BCLC_PROBS = {
    BCLCStage.STAGE_0: 0.08,
    BCLCStage.A: 0.22,
    BCLCStage.B: 0.30,
    BCLCStage.C: 0.28,
    BCLCStage.D: 0.12,
}
_CHILD_PROBS = {
    ChildPughClass.A: 0.55,
    ChildPughClass.B: 0.30,
    ChildPughClass.C: 0.15,
}
_ETIOLOGIES = ("HBV", "HCV", "alcohol", "NAFLD", "mixed", "unknown")

# 分期 → 更可能采用的治疗（权重）
_STAGE_TREATMENT_WEIGHTS: Dict[BCLCStage, Dict[TreatmentModality, float]] = {
    BCLCStage.STAGE_0: {
        TreatmentModality.ABLATION: 0.45,
        TreatmentModality.RESECTION: 0.25,
        TreatmentModality.NONE: 0.30,
    },
    BCLCStage.A: {
        TreatmentModality.ABLATION: 0.35,
        TreatmentModality.RESECTION: 0.30,
        TreatmentModality.TACE: 0.10,
        TreatmentModality.NONE: 0.25,
    },
    BCLCStage.B: {
        TreatmentModality.TACE: 0.45,
        TreatmentModality.TARE: 0.10,
        TreatmentModality.SYSTEMIC: 0.15,
        TreatmentModality.NONE: 0.30,
    },
    BCLCStage.C: {
        TreatmentModality.SYSTEMIC: 0.55,
        TreatmentModality.TACE: 0.15,
        TreatmentModality.PALLIATIVE: 0.10,
        TreatmentModality.NONE: 0.20,
    },
    BCLCStage.D: {
        TreatmentModality.PALLIATIVE: 0.60,
        TreatmentModality.NONE: 0.35,
        TreatmentModality.SYSTEMIC: 0.05,
    },
    BCLCStage.UNKNOWN: {
        TreatmentModality.NONE: 0.5,
        TreatmentModality.TACE: 0.25,
        TreatmentModality.SYSTEMIC: 0.25,
    },
}


def _choice_enum(rng: np.random.Generator, probs: Dict) -> object:
    keys = list(probs.keys())
    weights = np.asarray([probs[k] for k in keys], dtype=float)
    weights = weights / weights.sum()
    idx = int(rng.choice(len(keys), p=weights))
    return keys[idx]


class SyntheticGenerator:
    """可复现的合成队列生成器。

    每个 patient_index 使用派生种子 seed + index * 大质数，
    从而：
    - 同一 seed 下队列完全可复现
    - 增删「只生成前 N 人」时，已生成患者内容不变（对固定 index）
    """

    def __init__(
        self,
        seed: int = 42,
        max_visits: int = 12,
        missing_rate: float = 0.08,
        index_date: date | None = None,
        simulator: DiseaseSimulator | None = None,
    ) -> None:
        self.seed = int(seed)
        self.max_visits = int(max_visits)
        self.missing_rate = float(missing_rate)
        self.index_date = index_date or date(2024, 1, 1)
        self.simulator = simulator or DiseaseSimulator()

    def _patient_rng(self, patient_index: int) -> np.random.Generator:
        # 派生种子：避免「只用一个全局 RNG 顺序依赖」导致难复现切片
        return np.random.default_rng(self.seed + int(patient_index) * 1_000_003)

    def generate_one(self, patient_index: int = 0) -> PatientTrajectory:
        """生成单条患者轨迹并做 Schema 校验。"""
        rng = self._patient_rng(patient_index)
        patient = self._sample_patient(rng, patient_index)
        latent = self._sample_latent(rng, patient)
        features = self._sample_baseline_features(rng, patient, latent)

        visits: List[Visit] = []
        outcomes: List[Outcome] = []
        day = 0
        death = False
        # 下一步将使用的 Δt；必须与下一次 Visit.delta_t_days 一致
        pending_delta = 0.0

        for v_idx in range(self.max_visits):
            if death:
                break

            # 访视间隔：约 30–120 天；首访 Δt=0
            if v_idx == 0:
                delta = 0.0
            else:
                delta = pending_delta
                day += int(delta)

            treatments = self._sample_treatments(rng, patient.bclc_stage, day, v_idx)

            # 缺失掩码：独立伯努利；缺失处特征值仍保留但训练应以 mask 为准
            missing_mask = {
                k: bool(rng.random() < self.missing_rate) for k in CLINICAL_FEATURE_KEYS
            }
            # 肿瘤核心指标降低缺失率，避免整条轨迹「看不见瘤」
            for k in ("tumor_size_cm", "tumor_number", "afp"):
                if rng.random() < 0.7:
                    missing_mask[k] = False

            obs = Observation(
                visit_index=v_idx,
                days_from_index=day,
                delta_t_days=delta,
                features=clip_features(features),
                missing_mask=missing_mask,
            )
            visits.append(
                Visit(observation=obs, treatments=treatments, delta_t_days=delta)
            )

            # 推下一步：先抽样下一段 Δt，再用同一 Δt 做动力学与下一次访视
            if v_idx >= self.max_visits - 1:
                break

            pending_delta = float(rng.integers(30, 121))
            features, latent, event = self.simulator.step(
                features=features,
                latent=latent,
                treatments=treatments,
                delta_t_days=pending_delta,
                rng=rng,
            )
            if event is not None:
                outcomes.append(
                    Outcome(
                        days_from_index=day + int(pending_delta),
                        event=event,
                        occurred=True,
                    )
                )
                if event is OutcomeEvent.DEATH:
                    death = True

        if not outcomes:
            # 随访期末删失：明确写一条「未发生」记录，方便风险头对齐
            last_day = visits[-1].observation.days_from_index if visits else 0
            outcomes.append(
                Outcome(
                    days_from_index=last_day,
                    event=OutcomeEvent.NONE,
                    occurred=False,
                )
            )

        return PatientTrajectory(patient=patient, visits=visits, outcomes=outcomes)

    def generate(self, n_patients: int) -> List[PatientTrajectory]:
        """生成 n 条轨迹（patient_index = 0 .. n-1）。"""
        if n_patients < 0:
            raise ValueError("n_patients 必须 >= 0")
        return [self.generate_one(i) for i in range(int(n_patients))]

    # ------------------------------------------------------------------
    # 采样细节
    # ------------------------------------------------------------------

    def _sample_patient(self, rng: np.random.Generator, patient_index: int) -> Patient:
        sex = Sex.MALE if rng.random() < 0.72 else Sex.FEMALE  # HCC 男性偏多（合成）
        age = int(np.clip(rng.normal(62, 10), 25, 90))
        bclc = _choice_enum(rng, _BCLC_PROBS)
        child = _choice_enum(rng, _CHILD_PROBS)
        # 极晚期更多 Child-C（弱相关，非真实列联表）
        if bclc is BCLCStage.D and rng.random() < 0.5:
            child = ChildPughClass.C
        etiology = str(rng.choice(_ETIOLOGIES))
        # 索引日略作抖动，避免全队列同一天
        diag = self.index_date + timedelta(days=int(rng.integers(0, 365)))
        return Patient(
            patient_id=f"SYN{patient_index:05d}",
            sex=sex,
            age_at_index=age,
            diagnosis_date=diag,
            bclc_stage=bclc,  # type: ignore[arg-type]
            child_pugh=child,  # type: ignore[arg-type]
            etiology=etiology,
            data_source="synthetic",
            research_only=True,
        )

    def _sample_latent(self, rng: np.random.Generator, patient: Patient) -> LatentState:
        # 分期越晚，肿瘤生长与肝衰退系数越大
        stage_scale = {
            BCLCStage.STAGE_0: 0.4,
            BCLCStage.A: 0.7,
            BCLCStage.B: 1.0,
            BCLCStage.C: 1.4,
            BCLCStage.D: 1.8,
            BCLCStage.UNKNOWN: 1.0,
        }[patient.bclc_stage]
        child_scale = {
            ChildPughClass.A: 0.7,
            ChildPughClass.B: 1.0,
            ChildPughClass.C: 1.5,
            ChildPughClass.UNKNOWN: 1.0,
        }[patient.child_pugh]
        tumor_growth = float(np.clip(rng.normal(0.015, 0.006) * stage_scale, 0.001, 0.08))
        liver_decline = float(
            np.clip(rng.normal(0.008, 0.004) * child_scale, 0.0005, 0.05)
        )
        return LatentState(
            bclc=patient.bclc_stage,
            child_pugh=patient.child_pugh,
            tumor_growth=tumor_growth,
            liver_decline=liver_decline,
            hazard=0.0,
        )

    def _sample_baseline_features(
        self,
        rng: np.random.Generator,
        patient: Patient,
        latent: LatentState,
    ) -> Dict[str, float]:
        """按分期采样初始检验与肿瘤负荷。"""
        stage = patient.bclc_stage
        size_mu = {
            BCLCStage.STAGE_0: 1.5,
            BCLCStage.A: 2.5,
            BCLCStage.B: 4.5,
            BCLCStage.C: 6.5,
            BCLCStage.D: 8.0,
            BCLCStage.UNKNOWN: 4.0,
        }[stage]
        n_mu = {
            BCLCStage.STAGE_0: 1.0,
            BCLCStage.A: 1.2,
            BCLCStage.B: 3.0,
            BCLCStage.C: 4.0,
            BCLCStage.D: 5.0,
            BCLCStage.UNKNOWN: 2.0,
        }[stage]
        alb_mu = {
            ChildPughClass.A: 40.0,
            ChildPughClass.B: 33.0,
            ChildPughClass.C: 26.0,
            ChildPughClass.UNKNOWN: 35.0,
        }[patient.child_pugh]

        raw = {
            "afp": float(np.exp(rng.normal(np.log(80 + 40 * size_mu), 0.8))),
            "alt": float(np.clip(rng.normal(45, 20), 10, 400)),
            "ast": float(np.clip(rng.normal(50, 22), 10, 400)),
            "tbil": float(np.clip(rng.normal(18 + (40 - alb_mu) * 0.8, 8), 5, 200)),
            "albumin": float(np.clip(rng.normal(alb_mu, 3), 15, 50)),
            "inr": float(np.clip(rng.normal(1.05 + (40 - alb_mu) * 0.02, 0.1), 0.8, 2.5)),
            "platelet": float(np.clip(rng.normal(160 - 20 * latent.liver_decline * 50, 40), 30, 400)),
            "creatinine": float(np.clip(rng.normal(0.95, 0.2), 0.4, 3.0)),
            "tumor_size_cm": float(np.clip(rng.normal(size_mu, 0.8), 0.5, 20)),
            "tumor_number": float(np.clip(rng.normal(n_mu, 0.8), 1.0, 15)),
        }
        return clip_features(raw)

    def _sample_treatments(
        self,
        rng: np.random.Generator,
        stage: BCLCStage,
        day: int,
        visit_index: int,
    ) -> List[Treatment]:
        """每次访视以一定概率施加 0/1 个治疗事件。"""
        # 首访更高概率开始治疗；其后约 40% 有治疗记录
        p_treat = 0.75 if visit_index == 0 else 0.40
        if rng.random() > p_treat:
            return []

        weights_map = _STAGE_TREATMENT_WEIGHTS.get(
            stage, _STAGE_TREATMENT_WEIGHTS[BCLCStage.UNKNOWN]
        )
        modalities = list(weights_map.keys())
        probs = np.asarray([weights_map[m] for m in modalities], dtype=float)
        probs = probs / probs.sum()
        modality = modalities[int(rng.choice(len(modalities), p=probs))]
        if modality is TreatmentModality.NONE:
            return []
        intensity = float(np.clip(rng.normal(0.85, 0.1), 0.3, 1.0))
        return [
            Treatment(
                days_from_index=day,
                modality=modality,
                dose_intensity=intensity,
            )
        ]


def generate_cohort(
    n_patients: int,
    seed: int = 42,
    max_visits: int = 12,
) -> List[PatientTrajectory]:
    """函数式入口：生成合成队列。"""
    return SyntheticGenerator(seed=seed, max_visits=max_visits).generate(n_patients)
