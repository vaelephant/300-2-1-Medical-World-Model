"""疾病演化模拟器（合成数据用）。

职责：给定当前临床特征、潜在病情、治疗与 Δt，推进到下一访视状态。

重要声明（务必读）：
- 这里的动力学是**研究用合成假设**，不是真实肝癌病理生理模型。
- 目的是产生「看起来纵向合理、可供世界模型学习转移」的轨迹，
  以便打通训练/评估流水线；不能当作临床预测证据。
- 后续跨生成器泛化实验应换一套参数（见项目说明验收矩阵）。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import numpy as np

from packages.data.schemas import (
    CLINICAL_FEATURE_KEYS,
    BCLCStage,
    ChildPughClass,
    OutcomeEvent,
    Treatment,
    TreatmentModality,
    _FEATURE_RANGES,
)


@dataclass
class LatentState:
    """患者潜在病情（合成器内部状态，不直接进训练张量）。

    tumor_growth / liver_decline 是「每天」量级的漂移系数，
    step() 里会乘以 delta_t_days。
    """

    bclc: BCLCStage
    child_pugh: ChildPughClass
    tumor_growth: float
    liver_decline: float
    # 累积「未控肿瘤负荷」代理，用于触发进展/死亡概率
    hazard: float = 0.0


# 治疗对肿瘤/肝储备的瞬时相对效应（合成假设，非药效学）
_TREATMENT_TUMOR_EFFECT: Dict[TreatmentModality, float] = {
    TreatmentModality.NONE: 0.0,
    TreatmentModality.ABLATION: -0.35,
    TreatmentModality.RESECTION: -0.55,
    TreatmentModality.TACE: -0.25,
    TreatmentModality.TARE: -0.30,
    TreatmentModality.SYSTEMIC: -0.15,
    TreatmentModality.TRANSPLANT: -0.90,
    TreatmentModality.PALLIATIVE: 0.0,
    TreatmentModality.OTHER: -0.05,
}

_TREATMENT_LIVER_STRESS: Dict[TreatmentModality, float] = {
    TreatmentModality.NONE: 0.0,
    TreatmentModality.ABLATION: 0.02,
    TreatmentModality.RESECTION: 0.08,
    TreatmentModality.TACE: 0.05,
    TreatmentModality.TARE: 0.04,
    TreatmentModality.SYSTEMIC: 0.03,
    TreatmentModality.TRANSPLANT: -0.20,  # 移植后假设肝储备改善
    TreatmentModality.PALLIATIVE: 0.01,
    TreatmentModality.OTHER: 0.01,
}


def clip_features(features: Dict[str, float]) -> Dict[str, float]:
    """将特征裁剪到 Schema 工程范围，并保证有限。"""
    out: Dict[str, float] = {}
    for k in CLINICAL_FEATURE_KEYS:
        lo, hi = _FEATURE_RANGES[k]
        v = float(features[k])
        if not np.isfinite(v):
            v = lo
        out[k] = float(np.clip(v, lo, hi))
    return out


class DiseaseSimulator:
    """单步疾病演化。

    典型用法：由 SyntheticGenerator 在访视循环里反复调用 step()。
    """

    def step(
        self,
        features: Dict[str, float],
        latent: LatentState,
        treatments: List[Treatment],
        delta_t_days: float,
        rng: np.random.Generator,
    ) -> Tuple[Dict[str, float], LatentState, Optional[OutcomeEvent]]:
        """推进一个时间间隔。

        返回：
            next_features — 下一访视 x_{t+1}
            next_latent   — 更新后的潜在状态
            event         — 若本步触发恶化事件则返回枚举，否则 None
        """
        dt = max(float(delta_t_days), 0.0)
        x = {k: float(features[k]) for k in CLINICAL_FEATURE_KEYS}

        # --- 1) 汇总本步治疗效应 ---
        tumor_shock = 0.0
        liver_stress = 0.0
        for t in treatments:
            intensity = float(np.clip(t.dose_intensity, 0.0, 1.0))
            tumor_shock += _TREATMENT_TUMOR_EFFECT.get(t.modality, 0.0) * intensity
            liver_stress += _TREATMENT_LIVER_STRESS.get(t.modality, 0.0) * intensity

        # --- 2) 肿瘤负荷：对数尺度缓慢漂移 + 治疗冲击 + 噪声 ---
        # size / number / AFP 绑在同一「肿瘤代理」上，避免三者互相矛盾乱飘
        tumor_proxy = 0.6 * np.log1p(x["tumor_size_cm"]) + 0.4 * np.log1p(
            x["tumor_number"]
        )
        tumor_proxy = (
            tumor_proxy
            + latent.tumor_growth * dt
            + tumor_shock
            + rng.normal(0.0, 0.03 * np.sqrt(dt / 30.0 + 1e-6))
        )
        tumor_proxy = float(np.clip(tumor_proxy, 0.0, 5.0))

        # 由代理还原 size；number 在原值上乘性漂移
        size = float(np.clip(np.expm1(max(tumor_proxy, 0.0)), 0.1, 50.0))
        number = float(
            np.clip(
                x["tumor_number"]
                * np.exp(0.3 * latent.tumor_growth * dt + 0.5 * tumor_shock)
                + rng.normal(0.0, 0.05),
                0.0,
                50.0,
            )
        )
        afp = float(
            np.clip(
                x["afp"]
                * np.exp(0.5 * latent.tumor_growth * dt + 0.4 * tumor_shock)
                * np.exp(rng.normal(0.0, 0.05)),
                0.0,
                1_000_000.0,
            )
        )

        # --- 3) 肝功能：白蛋白下降、胆红素/INR 上升倾向 ---
        decline = latent.liver_decline * dt + liver_stress
        albumin = float(
            np.clip(
                x["albumin"] - 8.0 * decline + rng.normal(0.0, 0.3),
                5.0,
                60.0,
            )
        )
        tbil = float(
            np.clip(
                x["tbil"] * np.exp(0.4 * decline) + rng.normal(0.0, 0.5),
                0.0,
                1_000.0,
            )
        )
        inr = float(
            np.clip(
                x["inr"] * np.exp(0.25 * decline) + rng.normal(0.0, 0.02),
                0.5,
                10.0,
            )
        )
        alt = float(
            np.clip(
                x["alt"] * np.exp(0.1 * decline + 0.05 * abs(tumor_shock))
                + rng.normal(0.0, 2.0),
                0.0,
                5_000.0,
            )
        )
        ast = float(np.clip(alt * (1.05 + rng.normal(0.0, 0.05)), 0.0, 5_000.0))
        platelet = float(
            np.clip(
                x["platelet"] * np.exp(-0.3 * decline) + rng.normal(0.0, 3.0),
                1.0,
                2_000.0,
            )
        )
        creatinine = float(
            np.clip(
                x["creatinine"] * np.exp(0.05 * decline) + rng.normal(0.0, 0.02),
                0.1,
                30.0,
            )
        )

        next_features = clip_features(
            {
                "afp": afp,
                "alt": alt,
                "ast": ast,
                "tbil": tbil,
                "albumin": albumin,
                "inr": inr,
                "platelet": platelet,
                "creatinine": creatinine,
                "tumor_size_cm": size,
                "tumor_number": number,
            }
        )

        # --- 4) 更新 hazard，抽样是否发生预定义事件 ---
        new_hazard = float(
            latent.hazard
            + 0.01 * dt / 30.0
            + 0.02 * max(tumor_proxy - 1.0, 0.0)
            + 0.03 * max(decline, 0.0)
        )
        # 分期越晚，基础风险越高（合成假设）
        stage_boost = {
            BCLCStage.STAGE_0: 0.0,
            BCLCStage.A: 0.002,
            BCLCStage.B: 0.006,
            BCLCStage.C: 0.015,
            BCLCStage.D: 0.03,
            BCLCStage.UNKNOWN: 0.008,
        }[latent.bclc]
        p_event = float(
            np.clip(1.0 - np.exp(-(new_hazard * 0.05 + stage_boost) * (dt / 30.0)), 0.0, 0.35)
        )

        event: Optional[OutcomeEvent] = None
        if rng.random() < p_event:
            # 按 Child-Pugh / 肿瘤代理粗分事件类型
            if latent.child_pugh is ChildPughClass.C and rng.random() < 0.4:
                event = OutcomeEvent.LIVER_DECOMPENSATION
            elif tumor_proxy > 2.0 and rng.random() < 0.5:
                event = OutcomeEvent.PROGRESSION
            elif new_hazard > 1.5 and rng.random() < 0.15:
                event = OutcomeEvent.DEATH
            else:
                event = OutcomeEvent.PROGRESSION

        next_latent = LatentState(
            bclc=latent.bclc,
            child_pugh=latent.child_pugh,
            tumor_growth=latent.tumor_growth,
            liver_decline=latent.liver_decline,
            hazard=new_hazard,
        )
        return next_features, next_latent, event
