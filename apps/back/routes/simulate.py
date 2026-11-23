"""固定未来治疗条件下的模型情景实验。"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from packages.data.schemas import TreatmentModality
from apps.back.services.inference import get_service

router = APIRouter(prefix="/api/v1", tags=["simulate"])

class SimulateRequest(BaseModel):
    patient_id: str
    horizon: int = Field(4, ge=1, le=12)
    context_len: int = Field(3, ge=1, le=24)
    treatment_modality: TreatmentModality | None = None
    dose_intensity: float = Field(1.0, ge=0, le=1)

@router.post("/simulate")
def simulate(req: SimulateRequest):
    svc = get_service()
    try:
        out = svc.forecast(**req.model_dump())
    except KeyError:
        raise HTTPException(status_code=404, detail=f"患者不存在：{req.patient_id}")
    out["simulation"] = {
        "requested_treatment_modality": req.treatment_modality,
        "dose_intensity": req.dose_intensity if req.treatment_modality is not None else None,
        "applied": "future_treatment_override" if req.treatment_modality is not None else "context_last_treatment",
        "note": "从上下文末次随访起，每个预测步使用同一治疗条件。仅比较合成数据模型响应，不代表因果疗效或治疗建议。",
    }
    return out
