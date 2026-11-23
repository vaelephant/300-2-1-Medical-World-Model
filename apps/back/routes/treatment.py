"""治疗响应矩阵 API：治疗事件前后指标变化的描述性统计。"""

from __future__ import annotations

from fastapi import APIRouter

from apps.back.services.inference import get_service

router = APIRouter(prefix="/api/v1", tags=["treatment"])


@router.get("/treatment-response")
def treatment_response():
    """按治疗类别聚合「事件前一次随访 → 事件后一次随访」的指标变化。"""
    return get_service().treatment_response_summary()
