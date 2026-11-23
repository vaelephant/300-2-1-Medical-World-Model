"""评估指标 API（读取 reports/*.json）。"""

from __future__ import annotations

from fastapi import APIRouter

from apps.back.services.inference import get_service

router = APIRouter(prefix="/api/v1", tags=["evaluation"])


@router.get("/evaluations")
def evaluations():
    svc = get_service()
    report = svc.load_evaluation_report()
    report.setdefault("research_only", True)
    report.setdefault("model_version", svc.model_version)
    return report


@router.get("/models")
def models():
    svc = get_service()
    return svc.meta()
