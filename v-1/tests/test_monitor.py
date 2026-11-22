from pathlib import Path
import json
import os
from types import SimpleNamespace
import pandas as pd
import pytest
import torch
from mwm.core import FEATURES
from mwm.monitor import RunRecord, read_record, DashboardServer, shared_viz, ROOT
from mwm.training import main


def test_tiny_cpu_training_records_metrics_and_portable_checkpoint(tmp_path):
    events = tmp_path / 'events.parquet'
    # Enough subjects for patient-disjoint train/validation splits, one window per stay.
    rows = [(subject, subject, hour, feature, float(subject + hour / 10 + i))
            for subject in range(1, 11) for hour in range(26) for i, feature in enumerate(FEATURES)]
    pd.DataFrame(rows, columns=['subject_id', 'stay_id', 'hour', 'feature', 'value']).to_parquet(events)
    out = tmp_path / 'out'
    main(['--events', str(events), '--device', 'cpu', '--epochs', '2', '--hidden', '4',
          '--horizon', '2', '--batch', '4', '--out', str(out)], logdir=tmp_path / 'runs')
    record = read_record(next((tmp_path / 'runs').glob('*.json')))
    assert record['status'] == 'finished'
    assert len(record['history']) == 2
    assert record['batch'] == record['batches']
    assert record['best_val_nll'] == min(row['val_loss'] for row in record['history'])
    saved = torch.load(out / 'best.pt', map_location='cpu', weights_only=False)
    assert all(t.device.type == 'cpu' for t in saved['weights'].values())
    assert json.loads((out / 'metrics.json').read_text())['best_val_nll'] == record['best_val_nll']
    server = DashboardServer.__new__(DashboardServer)
    server.logdir = tmp_path / 'runs'
    server.active_run = None
    payload = server.read_run(record['id'] + '.jsonl')
    assert payload['end']['status'] == 'finished'
    assert len(payload['val']) == 2
    assert payload['train'][-1]['iteration'] == payload['meta']['config']['iters']
    assert payload['train'][-1]['samples_per_second'] > 0
    assert payload['train'][-1]['peak_memory'] is None
    assert payload['checkpoints'][0]['name'] == 'best.pt'
    assert len(server.list_runs()) == 1
    assert server.read_run('../../outside.jsonl') is None
    assert shared_viz.DASHBOARD == ROOT / 'dashboard.html'
    assert Path(shared_viz.__file__).parent == ROOT


def test_missing_data_records_failure(tmp_path):
    with pytest.raises(FileNotFoundError):
        main(['--events', str(tmp_path / 'missing.parquet'), '--device', 'cpu'], logdir=tmp_path)
    record = read_record(next(tmp_path.glob('*.json')))
    assert record['status'] == 'failed'
    assert 'FileNotFoundError' in record['error']
    assert 'python -m scripts.synthetic --patients 160' in record['error']


def test_interruption_persisted(tmp_path, monkeypatch):
    def stop(*args):
        raise KeyboardInterrupt
    monkeypatch.setattr('mwm.training.train', stop)
    with pytest.raises(KeyboardInterrupt):
        main(['--device', 'cpu'], logdir=tmp_path)
    assert read_record(next(tmp_path.glob('*.json')))['status'] == 'interrupted'


def test_dead_process_is_unknown(tmp_path, monkeypatch):
    record = RunRecord({}, tmp_path)
    def gone(*args):
        raise ProcessLookupError
    monkeypatch.setattr(os, 'kill', gone)
    assert read_record(record.path)['status'] == 'unknown'
    assert json.loads(record.path.read_text())['status'] == 'running'


def test_legacy_snapshot_is_visible_without_fabricated_throughput(tmp_path):
    server = DashboardServer.__new__(DashboardServer)
    server.logdir = tmp_path
    server.active_run = None
    data = dict(id='20261103-120000-12345678', pid=1, status='finished', phase='完成',
                started=1, updated=3, finished=3, batches=4, config={'epochs':1},
                history=[dict(epoch=1, train_loss=.4, val_loss=.3, seconds=2)])
    (tmp_path / (data['id'] + '.json')).write_text(json.dumps(data))
    payload = server.read_run(data['id'] + '.jsonl')
    assert payload['val'][0]['val_loss'] == .3
    assert 'samples_per_second' not in payload['train'][0]
    assert len(server.list_runs()) == 1
