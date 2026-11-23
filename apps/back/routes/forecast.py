"""未来状态预测 API。"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from apps.back.services.inference import get_service

router = APIRouter(prefix="/api/v1", tags=["forecast"])


class ForecastRequest(BaseModel):
    patient_id: str
    horizon: int = Field(4, ge=1, le=12, description="预测未来访视步数")
    context_len: int = Field(3, ge=1, le=24, description="用作上下文的历史访视数")


@router.post("/forecast")
def forecast(req: ForecastRequest):
    svc = get_service()
    try:
        return svc.forecast(
            patient_id=req.patient_id,
            horizon=req.horizon,
            context_len=req.context_len,
        )
    except KeyError:
        raise HTTPException(status_code=404, detail=f"患者不存在：{req.patient_id}")
