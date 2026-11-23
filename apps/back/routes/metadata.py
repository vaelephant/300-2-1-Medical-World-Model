"""产物元数据 API：provenance、训练历史、checkpoint 列表与评估报告列表。

这些数据全部从本地产物派生（manifest / train_meta / checkpoint 文件 / reports），
不加载新模型、不访问网络，也不返回占位数值。前端可据此展示模型卡、训练曲线与
checkpoint / report provenance。
"""

from __future__ import annotations

from fastapi import APIRouter

from apps.back.services.inference import get_service

router = APIRouter(prefix="/api/v1", tags=["metadata"])


@router.get("/provenance")
def provenance():
    """数据集、当前 checkpoint、当前评估报告与产物文件的来源信息。"""
    return get_service().provenance()


@router.get("/training")
def training():
    """训练历史与 split 摘要（读取 checkpoint 同目录 train_meta.json）。

    没有 train_meta.json 时返回 ``available=false``，不伪造训练曲线。
    """
    return get_service().training_info()


@router.get("/models/checkpoints")
def checkpoints():
    """模型目录下所有 .pt 的路径、大小、修改时间与是否为当前服务权重。"""
    svc = get_service()
    return {
        "checkpoints": svc.checkpoints(),
        "current_checkpoint": str(svc.checkpoint),
        "models_dir": str(svc.models_dir),
        "research_only": True,
    }


@router.get("/evaluations/reports")
def reports():
    """reports/ 下的评估报告列表（摘要），按修改时间倒序。"""
    svc = get_service()
    return {
        "reports": svc.reports(),
        "reports_dir": str(svc.reports_dir),
        "research_only": True,
    }
