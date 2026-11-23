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
