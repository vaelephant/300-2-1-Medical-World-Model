"""CLI：评估世界模型 vs Persistence，写出 reports/*.json。

示例：
  PYTHONPATH=. python scripts/evaluate_model.py \\
    --checkpoint artifacts/models/mvp/best.pt \\
    --data artifacts/synthetic --split test
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from packages.training.evaluate import evaluate_checkpoint


def main() -> None:
    p = argparse.ArgumentParser(description="Evaluate HCC world model")
    p.add_argument("--checkpoint", default="artifacts/models/mvp/best.pt")
    p.add_argument("--data", default="artifacts/synthetic")
    p.add_argument("--split", default="test", choices=["train", "val", "test"])
    p.add_argument("--device", default="auto")
    p.add_argument("--batch-size", type=int, default=32)
    p.add_argument("--context-len", type=int, default=3)
    p.add_argument(
        "--report",
        default=None,
        help="默认 reports/eval_<checkpoint父目录名>.json",
    )
    args = p.parse_args()

    ckpt = Path(args.checkpoint)
    report = Path(args.report) if args.report else Path("reports") / f"eval_{ckpt.parent.name}.json"

    out = evaluate_checkpoint(
        checkpoint=ckpt,
        data_dir=args.data,
        split=args.split,
        device_name=args.device,
        batch_size=args.batch_size,
        context_len=args.context_len,
        report_path=report,
    )
    summary = {
        "beats_persistence_mae_ex_afp": out["beats_persistence_mae_ex_afp"],
        "mae_ex_afp_wm": out["world_model"]["mae_ex_afp"],
        "mae_ex_afp_persistence": out["persistence"]["mae_ex_afp"],
        "beats_persistence_mae_macro": out["beats_persistence_mae_macro"],
        "beats_persistence_mae": out["beats_persistence_mae"],
        "mae_macro_wm": out["world_model"]["mae_macro"],
        "mae_macro_persistence": out["persistence"]["mae_macro"],
        "mae_wm": out["world_model"]["mae_mean"],
        "mae_persistence": out["persistence"]["mae_mean"],
        "report": str(report),
        "research_only": True,
        "note": "主看 mae_ex_afp；mae_mean/macro 仍可能被 AFP 原始尺度主导",
    }
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
