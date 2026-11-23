"""FastAPI 入口。

启动：
  cd 仓库根目录
  PYTHONPATH=. uvicorn apps.back.main:app --host 127.0.0.1 --port 8000 --reload

环境变量：
  MWM_CHECKPOINT  artifacts/models/mvp/best.pt
  MWM_DATA_DIR    artifacts/synthetic
  MWM_DEVICE      auto|cpu|mps|cuda
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from apps.back.routes import evaluation, forecast, patients, simulate
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
        version="0.2.0",
        description="研究原型推理服务（synthetic / research_only）。",
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

    @app.get("/health")
    def health():
        svc = get_service()
        return {
            "status": "ok",
            "research_only": True,
            "data_source": "synthetic",
            "model_version": svc.model_version,
            "checkpoint": str(svc.checkpoint),
        }

    return app


app = create_app()
