"""FastAPI 入口。

启动：
  cd 仓库根目录
  PYTHONPATH=. uvicorn apps.back.main:app --host 127.0.0.1 --port 8000 --reload

环境变量：
  MWM_CHECKPOINT  artifacts/models/mvp/best.pt
  MWM_DATA_DIR    artifacts/synthetic
  MWM_DEVICE      auto|cpu|mps|cuda
  MWM_MODELS_DIR  checkpoint 所在 models 根目录（默认由 checkpoint 推导）
  MWM_REPORTS_DIR reports
  MWM_EVAL_REPORT eval_mvp.json（reports/ 下的默认评估报告）
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from apps.back.routes import cohort, evaluation, forecast, latent, metadata, patients, simulate, treatment
from apps.back.services.inference import get_service, reset_service


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 启动时加载权重，失败则直接暴露错误
    reset_service()
    svc = get_service()
    app.state.inference = svc
    yield


def create_app() -> FastAPI:
    app = FastAPI(
        title="DR.SEEK HCC World Model API",
        version="0.7.0",
        description="研究原型推理服务（synthetic / research_only）；支持 provenance、训练历史、实时训练进度、checkpoint reload、队列摘要、latent 探索与治疗响应统计。",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(patients.router)
    app.include_router(forecast.router)
    app.include_router(simulate.router)
    app.include_router(evaluation.router)
    app.include_router(metadata.router)
    app.include_router(cohort.router)
    app.include_router(latent.router)
    app.include_router(treatment.router)

    @app.get("/health")
    def health():
        svc = get_service()
        dataset = svc.dataset_info()
        return {
            "status": "ok",
            "research_only": True,
            "data_source": svc.data_source,
            "model_version": svc.model_version,
            "checkpoint": str(svc.checkpoint),
            "dataset": {
                "available": dataset.get("available"),
                "data_source": dataset.get("data_source"),
                "seed": dataset.get("seed"),
                "n_patients_manifest": dataset.get("n_patients_manifest"),
                "max_visits": dataset.get("max_visits"),
                "manifest": dataset.get("manifest"),
            },
        }

    return app


app = create_app()
