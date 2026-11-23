"""L1：精选演示病例校验（apps/front/lib/demo-cases.json）。

`apps/front/lib/demo-cases.json` 是前端“精选演示病例”（页面 01）与
`项目文档/4-演示流程.md` 的单一数据源。本测试保证：

1. JSON 字段合法，能直接支撑“载入病例”的预设（context / horizon / 治疗情景）；
2. `source` 元信息存在，且指向的说明文档真实存在；
3. 本地 `artifacts/synthetic` 存在时，病例确实来自当前合成队列并可演示：
   患者 JSON 存在、随访数 >= context、前 context 次随访至少有一次治疗记录；
4. `artifacts/` 是本地生成产物（不入库），缺失时跳过第 3 条校验。

重新生成数据（ID 可能变化）后，请同步更新 demo-cases.json，再跑：

    python -m pytest tests/test_demo_cases.py -q
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from packages.data.schemas import TreatmentModality

ROOT = Path(__file__).resolve().parents[1]
CASES_FILE = ROOT / "apps" / "front" / "lib" / "demo-cases.json"
SYNTHETIC_DIR = ROOT / "artifacts" / "synthetic"

KNOWN_MODALITIES = {modality.value for modality in TreatmentModality}
EXPECTED_CASES = 5
MIN_CONTEXT, MAX_CONTEXT = 1, 24
MIN_HORIZON, MAX_HORIZON = 1, 12
MIN_SCENARIOS, MAX_SCENARIOS = 2, 3


def _load_payload() -> dict:
    assert CASES_FILE.is_file(), f"缺少精选病例文件：{CASES_FILE}"
    payload = json.loads(CASES_FILE.read_text(encoding="utf-8"))
    assert isinstance(payload, dict), "demo-cases.json 顶层必须是对象"
    return payload


def _is_int(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _non_empty_str(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip())


@pytest.fixture(scope="module")
def payload() -> dict:
    return _load_payload()


@pytest.fixture(scope="module")
def cases(payload: dict) -> list[dict]:
    cases = payload.get("cases")
    assert isinstance(cases, list), "cases 必须是数组"
    assert len(cases) == EXPECTED_CASES, (
        f"精选病例应为 {EXPECTED_CASES} 个，实际 {len(cases)} 个"
    )
    return cases


def test_source_metadata_and_doc_exist(payload: dict) -> None:
    """source 元信息必须完整，且 source.doc 指向的文档真实存在。"""
    source = payload.get("source")
    assert isinstance(source, dict), "缺少 source 元信息"
    for key in ("cohort", "n_patients", "selection", "validation", "doc"):
        assert key in source, f"source 缺少字段：{key}"
    assert source["n_patients"] == 1000, "source.n_patients 应为 1000（seed 42）"
    assert _non_empty_str(source["selection"]), "source.selection 必须解释筛选方法"
    assert _non_empty_str(source["validation"]), "source.validation 必须说明如何校验"

    doc_path = ROOT / source["doc"]
    assert doc_path.is_file(), f"source.doc 指向的文档不存在：{source['doc']}"


def test_case_fields_are_valid(cases: list[dict]) -> None:
    """每个病例的字段类型/取值范围合法，且 patientId 唯一。"""
    seen_ids: set[str] = set()
    for index, case in enumerate(cases):
        where = f"cases[{index}]"
        assert isinstance(case, dict), f"{where} 必须是对象"

        for key in ("patientId", "title", "stage", "reason", "focus"):
            assert _non_empty_str(case.get(key)), f"{where}.{key} 必须是非空字符串"

        patient_id = case["patientId"]
        assert patient_id not in seen_ids, f"patientId 重复：{patient_id}"
        seen_ids.add(patient_id)

        assert case["stage"] in {"A", "B", "C"}, (
            f"{where}.stage 必须是 BCLC A/B/C，实际 {case['stage']!r}"
        )

        context = case.get("context")
        assert _is_int(context) and MIN_CONTEXT <= context <= MAX_CONTEXT, (
            f"{where}.context 必须是 {MIN_CONTEXT}–{MAX_CONTEXT} 的整数，实际 {context!r}"
        )

        horizon = case.get("horizon")
        assert _is_int(horizon) and MIN_HORIZON <= horizon <= MAX_HORIZON, (
            f"{where}.horizon 必须是 {MIN_HORIZON}–{MAX_HORIZON} 的整数，实际 {horizon!r}"
        )

        treatments = case.get("treatments")
        assert isinstance(treatments, list), f"{where}.treatments 必须是数组"
        assert MIN_SCENARIOS <= len(treatments) <= MAX_SCENARIOS, (
            f"{where}.treatments 应有 {MIN_SCENARIOS}–{MAX_SCENARIOS} 个情景，"
            f"实际 {len(treatments)} 个"
        )
        assert all(_non_empty_str(item) for item in treatments), (
            f"{where}.treatments 的元素必须是非空字符串"
        )
        unknown = set(treatments) - KNOWN_MODALITIES
        assert not unknown, (
            f"{where}.treatments 含未知治疗类别：{sorted(unknown)}；"
            f"合法值见 packages/data/schemas.py TreatmentModality"
        )


def test_cases_match_local_synthetic_cohort(cases: list[dict]) -> None:
    """病例必须来自当前本地合成队列，且能支撑页面 02–04 的演示。

    队列是本地生成产物（`scripts/generate_data.py --seed 42 --n 1000`），
    不随仓库提交；缺失时跳过，结构校验仍会执行。
    """
    if not SYNTHETIC_DIR.is_dir():
        pytest.skip(
            "artifacts/synthetic 不存在（本地数据产物不入库）；"
            "跳过与当前合成队列的一致性校验。生成命令见 项目文档/0-快速启动.md"
        )

    for case in cases:
        patient_id = case["patientId"]
        path = SYNTHETIC_DIR / f"{patient_id}.json"
        assert path.is_file(), (
            f"病例 {patient_id} 不在当前合成队列中：{path} 不存在。"
            "重新生成数据后患者 ID 可能变化，请更新 apps/front/lib/demo-cases.json"
        )

        trajectory = json.loads(path.read_text(encoding="utf-8"))
        assert isinstance(trajectory, dict), f"{path} 内容不是对象"

        patient = trajectory.get("patient", {})
        assert patient.get("patient_id") == patient_id, (
            f"{path} 内的 patient_id 与文件名不一致"
        )
        assert patient.get("data_source") == "synthetic", (
            f"{patient_id} 不是合成数据，不能用于本演示"
        )
        assert patient.get("research_only") is True, (
            f"{patient_id} 缺少 research_only=true 标记"
        )

        visits = trajectory.get("visits")
        assert isinstance(visits, list) and visits, f"{patient_id} 没有任何随访记录"

        context = case["context"]
        assert len(visits) >= context, (
            f"{patient_id} 只有 {len(visits)} 次随访，少于预设 context={context}"
        )

        context_visits = visits[:context]
        assert any(visit.get("treatments") for visit in context_visits), (
            f"{patient_id} 前 {context} 次随访没有任何治疗记录；"
            "页面 02 无法讲“治疗事件 → 指标变化”，请换病例或调整 context"
        )
