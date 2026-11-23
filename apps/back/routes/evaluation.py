"""评估指标 API（读取 reports/*.json）。"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from apps.back.services.inference import get_service

router = APIRouter(prefix="/api/v1", tags=["evaluation"])


@router.get("/evaluations")
def evaluations(
    report: str | None = Query(
        None,
        description="reports/ 下的报告文件名（例如 eval_mvp.json）；省略时使用 MWM_EVAL_REPORT 或默认报告。",
    ),
):
    svc = get_service()
    data = svc.load_evaluation_report(report_name=report)
    if data.get("available") is False and report is not None:
        # 明确指定了某份报告但不可用：按 404 返回，便于前端区分“没传报告”和“报告名错误”。
        raise HTTPException(status_code=404, detail=data.get("message"))
    data.setdefault("research_only", True)
    data.setdefault("model_version", svc.model_version)
    return data


@router.get("/models")
def models():
    svc = get_service()
    return svc.meta()
