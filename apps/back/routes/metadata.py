"""产物元数据 API：provenance、训练历史、checkpoint 列表与评估报告列表。

这些数据全部从本地产物派生（manifest / train_meta / checkpoint 文件 / reports），
不加载新模型、不访问网络，也不返回占位数值。前端可据此展示模型卡、训练曲线与
checkpoint / report provenance。
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from apps.back.services.inference import get_service
from packages.data.dataset import FEATURE_DIM, TREATMENT_DIM, TREATMENT_MODALITIES
from packages.data.schemas import CLINICAL_FEATURE_KEYS

router = APIRouter(prefix="/api/v1", tags=["metadata"])


@router.get("/schema")
def schema():
    """模型输入/输出 schema 与当前 checkpoint 的结构超参（供模型结构页使用）。"""
    svc = get_service()
    config = svc.config
    return {
        "clinical_features": list(CLINICAL_FEATURE_KEYS),
        "treatment_modalities": list(TREATMENT_MODALITIES),
        "feature_dim": FEATURE_DIM,
        "treatment_dim": TREATMENT_DIM,
        "treatment_dim_note": "9 个治疗类别 one-hot + 1 维 dose_intensity",
        "encoder_input_dim": FEATURE_DIM * 2 + 1 + TREATMENT_DIM,
        "hidden_dim": config.get("hidden_dim"),
        "latent_dim": config.get("latent_dim"),
        "dropout": config.get("dropout"),
        "residual": config.get("residual", True),
        "multi_step": config.get("multi_step"),
        "multi_step_weight": config.get("multi_step_weight"),
        "max_visits": config.get("max_visits"),
        "training_max_patients": config.get("max_patients"),
        "model_version": svc.model_version,
        "device": str(svc.device),
        "data_source": svc.data_source,
        "research_only": True,
        "note": "training_max_patients 是训练子集上限，不是推理端加载的患者数。",
    }


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


@router.get("/training/live")
def training_live():
    """实时训练进度：读取 out_dir/train_progress.json；没有时回退到 train_meta。"""
    return get_service().training_live_info()


@router.post("/models/reload")
def reload_checkpoint(force: bool = Query(False, description="强制重载，即使 checkpoint 未变化")):
    """重新加载磁盘上的 checkpoint，让训练产出的新权重生效（无需重启 API）。"""
    try:
        return get_service().reload_checkpoint(force=force)
    except (OSError, RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=500, detail=f"重新加载 checkpoint 失败：{exc}")


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
