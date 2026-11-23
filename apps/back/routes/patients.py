"""患者列表与历史轨迹 API。"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from apps.back.services.inference import get_service

router = APIRouter(prefix="/api/v1", tags=["patients"])


@router.get("/patients")
def list_patients(
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    svc = get_service()
    patients = svc.list_patients(limit=limit, offset=offset)
    return {
        "patients": patients,
        "count": len(patients),
        "research_only": True,
        "data_source": "synthetic",
    }


@router.get("/patients/{patient_id}")
def get_patient(patient_id: str):
    svc = get_service()
    try:
        traj = svc.get_trajectory(patient_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"患者不存在：{patient_id}")
    payload = traj.model_dump(mode="json")
    payload["research_only"] = True
    payload["data_source"] = "synthetic"
    return payload
