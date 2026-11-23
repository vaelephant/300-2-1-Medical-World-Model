"""FastAPI：health / patients / forecast 冒烟测试。"""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
CKPT = ROOT / "artifacts" / "models" / "mvp" / "best.pt"
DATA = ROOT / "artifacts" / "synthetic"


@pytest.fixture(scope="module")
def client():
    if not CKPT.exists():
        pytest.skip("需要 artifacts/models/mvp/best.pt")
    if not DATA.exists():
        pytest.skip("需要 artifacts/synthetic")

    os.environ["MWM_CHECKPOINT"] = str(CKPT)
    os.environ["MWM_DATA_DIR"] = str(DATA)
    os.environ["MWM_DEVICE"] = "cpu"

    from apps.back.services.inference import reset_service
    from apps.back.main import create_app

    reset_service()
    app = create_app()
    with TestClient(app) as c:
        yield c
    reset_service()


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["research_only"] is True
    assert "model_version" in body
    # data_source 由本地 manifest 派生，而不是硬编码。
    assert body["data_source"] in {"synthetic", "unknown", "public"}
    assert body["dataset"]["available"] is True
    assert body["dataset"]["manifest"]["exists"] is True
    assert body["dataset"]["n_patients_manifest"] >= 1


def test_list_and_get_patient(client):
    r = client.get("/api/v1/patients?limit=5")
    assert r.status_code == 200
    items = r.json()["patients"]
    assert len(items) >= 1
    pid = items[0]["patient_id"]
    r2 = client.get(f"/api/v1/patients/{pid}")
    assert r2.status_code == 200
    traj = r2.json()
    assert traj["patient"]["patient_id"] == pid
    assert len(traj["visits"]) >= 1
    assert traj["research_only"] is True


def test_forecast(client):
    r = client.get("/api/v1/patients?limit=1")
    pid = r.json()["patients"][0]["patient_id"]
    fr = client.post(
        "/api/v1/forecast",
        json={"patient_id": pid, "horizon": 4, "context_len": 3},
    )
    assert fr.status_code == 200, fr.text
    body = fr.json()
    assert body["research_only"] is True
    assert body["data_source"] == "synthetic"
    assert body["patient_id"] == pid
    assert len(body["predictions"]) == 4
    assert "afp" in body["predictions"][0]["features"]
    assert body["model_version"]
    # 当前 MVP 不输出预测分布：必须显式说明不可用，而不是让前端误解为置信区间。
    assert body["uncertainty"] is None
    assert body["uncertainty_status"]["available"] is False
    assert body["uncertainty_status"]["reason"]


def test_models_and_evaluations(client):
    m = client.get("/api/v1/models")
    assert m.status_code == 200
    assert m.json()["research_only"] is True
    e = client.get("/api/v1/evaluations")
    assert e.status_code == 200
    assert e.json()["research_only"] is True


def test_forecast_origin_matches_context(client):
    pid = client.get('/api/v1/patients?limit=1').json()['patients'][0]['patient_id']
    visits = client.get(f'/api/v1/patients/{pid}').json()['visits']
    for context in [1, 3, 24]:
        body = client.post('/api/v1/forecast', json={'patient_id': pid, 'context_len': context, 'horizon': 2}).json()
        ctx = body['context_len']
        assert body['history_days'] == [v['observation']['days_from_index'] for v in visits[:ctx]]
        assert body['forecast_origin_day'] == visits[ctx - 1]['observation']['days_from_index']
        gap = sum(v['delta_t_days'] for v in visits[1:ctx]) / (ctx - 1) if ctx > 1 else 30
        assert body['step_days'] == pytest.approx(gap)
        assert body['predictions'][0]['days_from_index'] == pytest.approx(body['forecast_origin_day'] + gap)


def test_simulation_applies_future_condition(client):
    pid = client.get('/api/v1/patients?limit=1').json()['patients'][0]['patient_id']
    request = {'patient_id': pid, 'context_len': 3, 'horizon': 2}
    baseline = client.post('/api/v1/forecast', json=request).json()
    unchanged = client.post('/api/v1/simulate', json=request).json()
    assert unchanged['predictions'] == baseline['predictions']
    conditions = []
    for modality in ['none', 'tace', 'systemic']:
        response = client.post('/api/v1/simulate', json={**request, 'treatment_modality': modality, 'dose_intensity': 0.5})
        assert response.status_code == 200
        body = response.json()
        assert body['simulation']['applied'] == 'future_treatment_override'
        assert body['forecast_origin_day'] == baseline['forecast_origin_day']
        conditions.append(body['predictions'])
    assert conditions[0] != conditions[1]
    assert client.post('/api/v1/simulate', json={**request, 'treatment_modality': 'invalid'}).status_code == 422
    assert client.post('/api/v1/simulate', json={**request, 'dose_intensity': 2}).status_code == 422
    assert client.post('/api/v1/simulate', json={**request, 'patient_id': 'missing'}).status_code == 404


def test_forecast_does_not_use_later_observations(client, monkeypatch):
    from apps.back.services.inference import get_service
    svc = get_service()
    pid = svc.list_patients(limit=1)[0]['patient_id']
    original = svc.forecast(pid, context_len=2, horizon=2)
    changed = svc.get_trajectory(pid).model_copy(deep=True)
    for visit in changed.visits[2:]:
        visit.observation.days_from_index += 1000
        visit.delta_t_days += 1000
        visit.observation.features['afp'] = 999999
    monkeypatch.setattr(svc, 'get_trajectory', lambda _: changed)
    assert svc.forecast(pid, context_len=2, horizon=2) == original


def test_provenance_endpoint(client):
    r = client.get("/api/v1/provenance")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["research_only"] is True
    assert body["data_source"] in {"synthetic", "unknown", "public"}
    # 数据集 provenance 来自 manifest.json，而不是硬编码。
    assert body["dataset"]["available"] is True
    assert body["dataset"]["manifest"]["exists"] is True
    assert body["dataset"]["seed"] is not None
    assert body["checkpoint"]["path"]
    assert body["checkpoint"]["model_version"]
    # 当前报告与报告列表来自 reports/*.json。
    assert body["current_report"]["available"] is True
    assert isinstance(body["reports"], list) and body["reports"]
    assert any(item["report"]["path"].endswith("eval_mvp.json") for item in body["reports"])
    assert isinstance(body["checkpoints"], list) and body["checkpoints"]
    assert any(item["is_current"] for item in body["checkpoints"])


def test_training_endpoint(client):
    r = client.get("/api/v1/training")
    assert r.status_code == 200, r.text
    body = r.json()
    assert "available" in body
    if body["available"]:
        assert body["checkpoint"]["exists"] is True
        assert isinstance(body["history"], list) and body["history"]
        assert body["epochs_trained"] == len(body["history"])
        assert body["best_val"] is not None
        assert body["splits"]["n_train"] >= 1
        assert body["model_version"]
    else:
        # 没有 train_meta.json 时必须说明原因，而不是返回空曲线。
        assert body["reason"]


def test_checkpoints_endpoint(client):
    r = client.get("/api/v1/models/checkpoints")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["current_checkpoint"]
    assert isinstance(body["checkpoints"], list) and body["checkpoints"]
    current = [item for item in body["checkpoints"] if item["is_current"]]
    assert len(current) == 1
    assert current[0]["exists"] is True
    assert current[0]["size_bytes"] > 0


def test_reports_endpoint_and_report_selection(client):
    listing = client.get("/api/v1/evaluations/reports")
    assert listing.status_code == 200, listing.text
    reports = listing.json()["reports"]
    assert isinstance(reports, list) and reports
    names = [item["report"]["path"].rsplit("/", 1)[-1] for item in reports]
    assert "eval_mvp.json" in names

    default = client.get("/api/v1/evaluations")
    assert default.status_code == 200
    explicit = client.get("/api/v1/evaluations", params={"report": "eval_mvp.json"})
    assert explicit.status_code == 200
    assert explicit.json()["available"] is True
    assert explicit.json()["report_file"].endswith("eval_mvp.json")

    missing = client.get("/api/v1/evaluations", params={"report": "does-not-exist.json"})
    assert missing.status_code == 404
    traversal = client.get("/api/v1/evaluations", params={"report": "../eval_mvp.json"})
    assert traversal.status_code == 404


def test_models_meta_includes_derived_provenance(client):
    body = client.get("/api/v1/models").json()
    assert body["data_source"] in {"synthetic", "unknown", "public"}
    assert "training" in body
    assert "available" in body["training"]
    assert body["predictive_uncertainty"]["available"] is False
    assert body["predictive_uncertainty"]["reason"]


def test_training_live_endpoint(client):
    body = client.get("/api/v1/training/live").json()
    assert body["available"] is True
    assert body["source"] in {"progress", "train_meta"}
    assert body["status"] in {"running", "evaluating", "finished"}
    assert isinstance(body["history"], list) and body["history"]
    assert "checkpoint_changed_on_disk" in body


def test_reload_checkpoint_endpoint(client):
    unchanged = client.post("/api/v1/models/reload").json()
    assert unchanged["reloaded"] is False
    assert "checkpoint" in unchanged

    forced = client.post("/api/v1/models/reload", params={"force": True}).json()
    assert forced["reloaded"] is True
    assert forced["model_version"]
    assert "previous_model_version" in forced
    assert client.post("/api/v1/models/reload").json()["reloaded"] is False


def test_inference_loads_full_cohort_not_training_subset(client):
    # checkpoint 的 max_patients 是训练子集上限（例如 300），推理端不能据此截断患者。
    first = client.get("/api/v1/patients?limit=1").json()
    assert first["count"] == 1
    demo_case = "SYN00733"
    if (DATA / f"{demo_case}.json").exists():
        response = client.get(f"/api/v1/patients/{demo_case}")
        assert response.status_code == 200, response.text
        assert response.json()["patient"]["patient_id"] == demo_case


def test_cohort_summary_endpoint(client):
    body = client.get("/api/v1/cohort/summary").json()
    assert body["available"] is True
    assert body["research_only"] is True
    assert body["data_source"] in {"synthetic", "unknown", "public"}
    assert body["n_patients"] == len(body["patients"]) >= 1
    sample = body["patients"][0]
    for key in (
        "patient_id",
        "bclc_stage",
        "child_pugh",
        "baseline",
        "last",
        "treatments",
        "n_treatments",
        "outcomes",
        "follow_up_days",
    ):
        assert key in sample
    assert set(sample["baseline"]) >= {"tumor_size_cm", "afp", "albumin", "tbil"}
    aggregate = body["aggregate"]
    assert sum(aggregate["stage_counts"].values()) == body["n_patients"]
    assert "progression_days" in aggregate
    assert "不是风险模型" in body["note"]


def test_latent_endpoint(client):
    pid = client.get("/api/v1/patients?limit=1").json()["patients"][0]["patient_id"]
    response = client.get(f"/api/v1/latent/{pid}", params={"horizon": 3})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["research_only"] is True
    assert body["patient_id"] == pid
    assert body["horizon"] == 3
    assert len(body["cohort"]) >= 1
    assert len(body["observed"]) >= 1
    assert len(body["forecast"]) == 3
    for point in body["observed"] + body["forecast"]:
        assert isinstance(point["x"], float) and isinstance(point["y"], float)
    assert len(body["pca"]["explained_variance"]) >= 1
    assert "无临床含义" in body["pca"]["note"]
    assert client.get("/api/v1/latent/missing").status_code == 404
