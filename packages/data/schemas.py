"""HCC 患者状态 Schema（D02）。

本模块只定义「数据契约」，不负责生成或训练。

世界模型状态（见 项目文档/2-项目说明.md）：

    s_t = (x_t, m_t, a_t, Δt)

其中：
    x_t  — 临床特征（检验、肿瘤负荷等）
    m_t  — 缺失掩码（与 x_t 键一一对应）
    a_t  — 该访视附近的治疗事件
    Δt   — 距上一访视（或索引日）的时间间隔（天）

设计原则：
1. 字段尽量贴近肝癌随访常见指标，但本阶段是研究原型，不是医院 HIS 标准。
2. 所有对外样本默认 data_source=synthetic、research_only=True，避免误当临床结论。
3. 用 Pydantic v2 做运行时校验；后续可用 model_json_schema() 导出 JSON Schema。
"""

from __future__ import annotations

from datetime import date
from enum import Enum
from typing import Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


# ---------------------------------------------------------------------------
# 临床特征键：固定顺序，方便 Dataset 对齐成 feature_dim 向量
# ---------------------------------------------------------------------------

# 说明：
# - 键名用英文 snake_case，便于 Parquet / PyTorch 列名稳定。
# - 单位约定写在注释里；合成器与真实数据适配层都必须遵守同一单位。
# - configs/data.yaml 的 feature_dim=32 是「模型输入维度」上限；
#   这里的原始连续特征远少于 32，Dataset 阶段可再做衍生/填充。
CLINICAL_FEATURE_KEYS: tuple[str, ...] = (
    "afp",            # 甲胎蛋白 AFP，ng/mL
    "alt",            # 丙氨酸转氨酶 ALT，U/L
    "ast",            # 天冬氨酸转氨酶 AST，U/L
    "tbil",           # 总胆红素 Total bilirubin，μmol/L
    "albumin",        # 白蛋白 Albumin，g/L
    "inr",            # 国际标准化比值 INR，无量纲
    "platelet",       # 血小板 ×10^9/L
    "creatinine",     # 肌酐 mg/dL（合成数据统一用此单位）
    "tumor_size_cm",  # 最大病灶直径，cm
    "tumor_number",   # 病灶个数（连续化存储，解码时可 round）
)

# 合理范围：用于粗校验，防止明显脏数据进入训练。
# 注意：这是工程护栏，不是临床正常参考值。
_FEATURE_RANGES: Dict[str, tuple[float, float]] = {
    "afp": (0.0, 1_000_000.0),
    "alt": (0.0, 5_000.0),
    "ast": (0.0, 5_000.0),
    "tbil": (0.0, 1_000.0),
    "albumin": (5.0, 60.0),
    "inr": (0.5, 10.0),
    "platelet": (1.0, 2_000.0),
    "creatinine": (0.1, 30.0),
    "tumor_size_cm": (0.0, 50.0),
    "tumor_number": (0.0, 50.0),
}


# ---------------------------------------------------------------------------
# 枚举：控制类别字段，避免自由字符串漂移
# ---------------------------------------------------------------------------


class Sex(str, Enum):
    """生物学性别（简化二分类，研究原型够用）。"""

    MALE = "male"
    FEMALE = "female"
    UNKNOWN = "unknown"


class BCLCStage(str, Enum):
    """BCLC 分期（Barcelona Clinic Liver Cancer）。

    世界模型用分期作为基线条件之一；合成器按分期调制肿瘤生长与治疗策略。
    """

    STAGE_0 = "0"  # 枚举成员名不能是数字，故用 STAGE_0；值为 "0"
    A = "A"
    B = "B"
    C = "C"
    D = "D"
    UNKNOWN = "unknown"


class ChildPughClass(str, Enum):
    """Child-Pugh 肝功能分级。"""

    A = "A"
    B = "B"
    C = "C"
    UNKNOWN = "unknown"


class TreatmentModality(str, Enum):
    """治疗模态 a_t。

    V1 只编码「做了什么类治疗」，不做精细剂量药理学仿真。
    dose_intensity ∈ [0, 1] 表示相对强度/完成度（合成假设）。
    """

    NONE = "none"                 # 观察 / 未治疗
    ABLATION = "ablation"         # 消融（RFA/MWA 等）
    RESECTION = "resection"       # 手术切除
    TACE = "tace"                 # 经动脉化疗栓塞
    TARE = "tare"                 # 放射栓塞
    SYSTEMIC = "systemic"         # 系统治疗（靶向/免疫等合并）
    TRANSPLANT = "transplant"     # 肝移植
    PALLIATIVE = "palliative"     # 姑息/支持
    OTHER = "other"


class OutcomeEvent(str, Enum):
    """预定义恶化 / 结局事件（风险头 y 的标签空间）。"""

    NONE = "none"
    PROGRESSION = "progression"           # 影像/临床进展
    LIVER_DECOMPENSATION = "liver_decompensation"
    RECURRENCE = "recurrence"
    DEATH = "death"
    OTHER = "other"


# ---------------------------------------------------------------------------
# 基础模型配置
# ---------------------------------------------------------------------------


class _SchemaBase(BaseModel):
    """所有 Schema 的公共配置。"""

    # 禁止未声明字段：防止合成器偷偷塞入未文档化列
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


# ---------------------------------------------------------------------------
# Patient：索引日基线（不随每次访视变的静态/半静态信息）
# ---------------------------------------------------------------------------


class Patient(_SchemaBase):
    """患者基线档案。

    patient_id 在整个 Feature Store / 切分 / API 中必须唯一。
    diagnosis_date 作为「索引日」：Visit.days_from_index 相对此日计算。
    """

    patient_id: str = Field(..., min_length=1, description="唯一患者 ID")
    sex: Sex
    age_at_index: int = Field(..., ge=0, le=120, description="索引日年龄（岁）")
    diagnosis_date: date = Field(..., description="诊断/入组索引日")
    bclc_stage: BCLCStage = BCLCStage.UNKNOWN
    child_pugh: ChildPughClass = ChildPughClass.UNKNOWN
    etiology: str = Field(
        default="unknown",
        description="病因简述，如 HBV / HCV / alcohol / NAFLD / mixed / unknown",
    )

    # --- 研究元数据：推理响应与落盘都必须保留 ---
    data_source: str = Field(
        default="synthetic",
        description="synthetic | public_cohort | hospital（医院数据需授权后再用）",
    )
    research_only: bool = Field(
        default=True,
        description="必须为 True：本 Schema 产出仅供研究原型",
    )

    @field_validator("patient_id")
    @classmethod
    def _patient_id_not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("patient_id 不能为空或纯空白")
        return v.strip()


# ---------------------------------------------------------------------------
# Observation：单次访视的 x_t + m_t
# ---------------------------------------------------------------------------


class Observation(_SchemaBase):
    """一次随访观察。

    features 与 missing_mask 必须覆盖且仅覆盖 CLINICAL_FEATURE_KEYS。
    缺失值约定：
        - missing_mask[k] is True  → 该特征缺失；features[k] 可填占位 0.0
        - Dataset 编码时以 mask 为准，勿把占位 0 当成真实测得
    """

    visit_index: int = Field(..., ge=0, description="从 0 开始的访视序号")
    days_from_index: int = Field(
        ...,
        ge=0,
        description="相对 Patient.diagnosis_date 的天数（整数天）",
    )
    # 冗余存一份 Δt，便于单条 Observation 独立序列化；
    # Visit.delta_t_days 应与此一致（由组装方保证）。
    delta_t_days: float = Field(
        ...,
        ge=0.0,
        description="距上一访视的天数；首访通常为 0",
    )
    features: Dict[str, float]
    missing_mask: Dict[str, bool]

    @model_validator(mode="after")
    def _check_feature_and_mask(self) -> Observation:
        keys = set(CLINICAL_FEATURE_KEYS)
        feat_keys = set(self.features.keys())
        mask_keys = set(self.missing_mask.keys())

        if feat_keys != keys:
            raise ValueError(
                f"features 键必须恰好为 CLINICAL_FEATURE_KEYS，"
                f"多出={feat_keys - keys}，缺少={keys - feat_keys}"
            )
        if mask_keys != keys:
            raise ValueError(
                f"missing_mask 键必须恰好为 CLINICAL_FEATURE_KEYS，"
                f"多出={mask_keys - keys}，缺少={keys - mask_keys}"
            )

        for name, value in self.features.items():
            lo, hi = _FEATURE_RANGES[name]
            # 缺失特征允许占位，不做范围检查
            if self.missing_mask[name]:
                continue
            if not (lo <= value <= hi):
                raise ValueError(
                    f"特征 {name}={value} 超出工程范围 [{lo}, {hi}]"
                )
        return self


# ---------------------------------------------------------------------------
# Treatment / Outcome：动作与标签
# ---------------------------------------------------------------------------


class Treatment(_SchemaBase):
    """治疗事件 a（可挂在某次 Visit 上，也可在轨迹层汇总）。"""

    days_from_index: int = Field(..., ge=0)
    modality: TreatmentModality = TreatmentModality.NONE
    dose_intensity: float = Field(
        default=1.0,
        ge=0.0,
        le=1.0,
        description="相对强度/完成度，合成假设，非真实药代剂量",
    )
    notes: Optional[str] = Field(default=None, max_length=500)


class Outcome(_SchemaBase):
    """结局 / 恶化事件记录。

    occurred=False 且 event=NONE 表示随访期内未观测到预定义事件。
    风险头训练时通常把 horizon 内是否发生某事件做成二分类标签。
    """

    days_from_index: int = Field(..., ge=0)
    event: OutcomeEvent = OutcomeEvent.NONE
    occurred: bool = True
    notes: Optional[str] = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def _consistent_event_flag(self) -> Outcome:
        # 未发生时强制 event=NONE，避免「NONE 但 occurred=True」这种矛盾标签
        if not self.occurred and self.event is not OutcomeEvent.NONE:
            raise ValueError("occurred=False 时 event 必须为 NONE")
        if self.occurred and self.event is OutcomeEvent.NONE:
            raise ValueError("occurred=True 时 event 不能为 NONE")
        return self


# ---------------------------------------------------------------------------
# Visit / PatientTrajectory：把 s_t 串成纵向轨迹
# ---------------------------------------------------------------------------


class Visit(_SchemaBase):
    """单次状态快照：组装 s_t = (x_t, m_t, a_t, Δt)。"""

    observation: Observation
    treatments: List[Treatment] = Field(default_factory=list)
    delta_t_days: float = Field(..., ge=0.0)

    @model_validator(mode="after")
    def _align_delta_t(self) -> Visit:
        # Observation 内嵌的 delta_t 与 Visit 层保持一致，避免两处口径打架
        if abs(self.delta_t_days - self.observation.delta_t_days) > 1e-6:
            raise ValueError(
                "Visit.delta_t_days 必须与 Observation.delta_t_days 一致"
            )
        return self


class PatientTrajectory(_SchemaBase):
    """一条完整患者轨迹（合成生成器 / Dataset 的基本单位）。

    约束：
    - visits 按时间非递减（days_from_index）
    - visit_index 建议从 0..N-1 连续，但不在此强制（方便子序列切片）
    - max_visits 由 configs/data.yaml 控制截断，本 Schema 不截断
    """

    patient: Patient
    visits: List[Visit] = Field(default_factory=list)
    outcomes: List[Outcome] = Field(default_factory=list)

    @model_validator(mode="after")
    def _time_non_decreasing(self) -> PatientTrajectory:
        prev_day: Optional[int] = None
        for i, visit in enumerate(self.visits):
            day = visit.observation.days_from_index
            if prev_day is not None and day < prev_day:
                raise ValueError(
                    f"visits 时间必须非递减：第 {i} 次 "
                    f"days_from_index={day} < 前一次 {prev_day}"
                )
            prev_day = day

            # 治疗时间不应早于「过于离谱」——允许同一天；禁止负偏移已在字段保证
            for t in visit.treatments:
                if t.days_from_index < day - 7:
                    # 允许治疗记录略早于访视日（例如提前一周入院），超过则报错
                    raise ValueError(
                        f"治疗日 {t.days_from_index} 早于访视日 {day} 超过 7 天"
                    )
        return self

    def to_json_schema_dict(self) -> dict:
        """导出 JSON Schema，便于 D02 文档与跨语言校验。"""
        return self.__class__.model_json_schema()
