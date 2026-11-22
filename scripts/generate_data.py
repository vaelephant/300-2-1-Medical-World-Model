"""CLI：生成合成患者轨迹（D03）。

示例：
    PYTHONPATH=. python scripts/generate_data.py --n 1000 --seed 42 --out artifacts/synthetic
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from packages.data.synthetic_generator import generate_cohort


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate synthetic HCC trajectories")
    parser.add_argument("--n", type=int, default=1000, help="患者数量")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--max-visits", type=int, default=12)
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("artifacts/synthetic"),
        help="输出目录（每名患者一个 json）",
    )
    args = parser.parse_args()

    trajs = generate_cohort(
        n_patients=args.n, seed=args.seed, max_visits=args.max_visits
    )
    args.out.mkdir(parents=True, exist_ok=True)
    manifest = []
    for traj in trajs:
        path = args.out / f"{traj.patient.patient_id}.json"
        path.write_text(traj.model_dump_json(indent=2), encoding="utf-8")
        manifest.append(traj.patient.patient_id)

    (args.out / "manifest.json").write_text(
        json.dumps(
            {
                "n": len(manifest),
                "seed": args.seed,
                "max_visits": args.max_visits,
                "data_source": "synthetic",
                "research_only": True,
                "patient_ids": manifest,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"wrote {len(trajs)} trajectories → {args.out}")


if __name__ == "__main__":
    main()
