"""Latent 空间探索 API：队列 latent PCA + 指定患者 latent 观测/预测路径。"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from apps.back.services.inference import get_service

router = APIRouter(prefix="/api/v1", tags=["latent"])


@router.get("/latent/{patient_id}")
def latent(
    patient_id: str,
    horizon: int = Query(4, ge=1, le=12, description="latent rollout 预测步数"),
):
    """返回队列 latent 2D 投影 + 指定患者 observed / forecast 轨迹投影。

    投影坐标轴无临床含义，仅用于探索 encoder 状态空间，不是生物标志物/风险预测。
    """
    try:
        return get_service().latent_patient(patient_id, horizon=horizon)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"患者不存在：{patient_id}")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
