"""Local read-only monitor, following mlx/train_viz.py's stdlib server pattern."""
import json
import os
from pathlib import Path
import importlib.util
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
RUNS = ROOT / 'runs'
# Load the project-local copy; no dependency on the sibling mlx directory.
_spec = importlib.util.spec_from_file_location('medical_train_viz', ROOT / 'train_viz.py')
shared_viz = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(shared_viz)


def config_for(data):
    c = data['config']
    return dict(c, project_name='Medical World Model', model='GRU WorldModel',
                fine_tune_type='full', monitor_type='medical', data=c.get('events'),
                adapter_path=c.get('out'), batch_size=c.get('batch'), learning_rate=3e-4,
                iters=c.get('epochs', 0) * data.get('batches', 0),
                device=data.get('device', c.get('device')), precision=data.get('precision'),
                memory_label='CUDA peak allocated' if data.get('device') == 'cuda' else 'MPS allocated (sampled max)' if data.get('device') == 'mps' else 'CPU 内存未采集',
                num_layers=2, save_every='best validation', seed=42)



class RunRecord:
    def __init__(self, config, directory=RUNS):
        self.id = time.strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:8]
        self.path = Path(directory) / (self.id + '.json')
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.data = dict(id=self.id, pid=os.getpid(), status='running', phase='准备数据',
                         started=time.time(), updated=time.time(), config=config,
                         epoch=0, batch=0, batches=0, history=[], logs=[])
        self.logger = shared_viz.RunLogger(self.path.with_suffix('.jsonl'), config_for(self.data))
        self.update()

    def update(self, **values):
        self.data.update(values)
        self.data['updated'] = time.time()
        temp = self.path.with_suffix('.tmp')
        temp.write_text(json.dumps(self.data, ensure_ascii=False, allow_nan=False), encoding='utf-8')
        temp.replace(self.path)
        if any(k in values for k in ('device', 'precision', 'batches')):
            self.logger.write({'type': 'meta', 'time': self.data['started'],
                               'cwd': os.getcwd(), 'config': config_for(self.data)})

    def event(self, kind, **values):
        self.logger.write({'type': kind, **values})

    def log(self, message):
        print(message, flush=True)
        self.data['logs'] = (self.data['logs'] + [message])[-100:]
        self.update()

    def finish(self, status, error=None):
        self.update(status=status, error=error, finished=time.time())
        self.logger.close(status, error)


def read_record(path):
    data = json.loads(path.read_text(encoding='utf-8'))
    if data['status'] == 'running':
        try:
            os.kill(data['pid'], 0)
        except (ProcessLookupError, PermissionError):
            data['status'] = 'unknown'
    return data


class DashboardServer(shared_viz.DashboardServer):
    """Use the MLX server and page; adapt .pt artifacts and older JSON snapshots."""
    def __init__(self, port=8766, directory=RUNS):
        super().__init__(Path(directory), '127.0.0.1', port)

    def read_run(self, run_id):
        if not shared_viz.RUN_ID_RE.fullmatch(run_id or ''):
            return None
        snapshot = self.logdir / (run_id[:-6] + '.json')
        data = super().read_run(run_id)
        if snapshot.is_file():
            old = read_record(snapshot)
            if data is None:
                data = self.legacy_run(old)
            data['live'] = old['status'] == 'running' and data['end'] is None
        return data

    def list_runs(self):
        rows = super().list_runs()
        ids = {r['id'] for r in rows}
        for path in self.logdir.glob('*.json'):
            old = read_record(path)
            run_id = path.stem + '.jsonl'
            if run_id not in ids:
                rows.append(dict(id=run_id, mtime=old['updated'], start=old['started'],
                                 project='Medical World Model', model='GRU WorldModel',
                                 status=old['status'], live=old['status'] == 'running'))
            else:
                next(r for r in rows if r['id'] == run_id)['live'] = old['status'] == 'running'
        return sorted(rows, key=lambda r: r['mtime'], reverse=True)

    def legacy_run(self, d):
        # Old records contain epoch averages only; do not invent batch throughput or memory.
        rows = d['history']
        meta = dict(config=config_for(d), time=d['started'], cwd=str(ROOT))
        train = [dict(r, iteration=r['epoch'] * d['batches'], time=d['started'] + sum(x['seconds'] for x in rows[:i+1])) for i, r in enumerate(rows)]
        val = [dict(r, iteration=r['iteration'], val_time=None) for r in train]
        end = None if d['status'] in ('running', 'unknown') else dict(status=d['status'], time=d.get('finished', d['updated']), error=d.get('error'))
        return dict(id=d['id'] + '.jsonl', project='Medical World Model', meta=meta,
                    train=train, val=val, end=end, live=d['status'] == 'running',
                    mtime=d['updated'], now=time.time(), checkpoints=self._checkpoints(meta))

    @staticmethod
    def _checkpoints(meta):
        if not meta:
            return []
        folder = Path(meta.get('cwd') or ROOT) / (meta['config'].get('adapter_path') or 'outputs')
        return [dict(name=p.name, size=p.stat().st_size, mtime=p.stat().st_mtime)
                for p in folder.glob('*.pt')]

    def close(self):
        self.httpd.shutdown()
        self.httpd.server_close()
