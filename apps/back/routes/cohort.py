"""队列摘要 API：一次返回全部合成患者的基线/末次指标、治疗事件与结局。"""

from __future__ import annotations

from fastapi import APIRouter

from apps.back.services.inference import get_service

router = APIRouter(prefix="/api/v1", tags=["cohort"])


@router.get("/cohort/summary")
def cohort_summary():
    """队列探索页使用；只读本地合成轨迹，结果在服务内缓存。"""
    return get_service().cohort_summary()
