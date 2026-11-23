"""启动推理 API。

  PYTHONPATH=. python scripts/serve_api.py
  # 或
  PYTHONPATH=. uvicorn apps.back.main:app --host 127.0.0.1 --port 8000
"""

from __future__ import annotations

import argparse
import os


def main() -> None:
    p = argparse.ArgumentParser(description="Serve HCC World Model API")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--checkpoint", default="artifacts/models/mvp/best.pt")
    p.add_argument("--data", default="artifacts/synthetic")
    p.add_argument("--device", default="auto")
    p.add_argument("--reload", action="store_true")
    args = p.parse_args()

    os.environ["MWM_CHECKPOINT"] = args.checkpoint
    os.environ["MWM_DATA_DIR"] = args.data
    os.environ["MWM_DEVICE"] = args.device

    import uvicorn

    uvicorn.run(
        "apps.back.main:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
    )


if __name__ == "__main__":
    main()
