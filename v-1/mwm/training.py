"""Training with portable checkpoints and atomic monitoring snapshots."""
import argparse
from contextlib import nullcontext
import json
from pathlib import Path
import time

import numpy as np
import torch
from torch.utils.data import DataLoader
from mwm.core import DatasetWindows, WorldModel, nll
from mwm.device import resolve_device, resolve_precision
from mwm.monitor import RunRecord, RUNS


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--events', default='data/processed/events.parquet')
    for name, default in [('epochs', 5), ('batch', 64), ('hidden', 128), ('horizon', 6)]:
        p.add_argument('--' + name, type=int, default=default)
    p.add_argument('--out', default='outputs')
    p.add_argument('--device', choices=['auto', 'mac', 'mps', 'gpu', 'cuda', 'cpu'], default='auto')
    p.add_argument('--precision', choices=['auto', 'fp32', 'bf16'], default='auto')
    p.add_argument('--check-device', action='store_true')
    return p


def validate_events(path):
    if not Path(path).is_file():
        raise FileNotFoundError(
            f'训练数据不存在：{Path(path).resolve()}\n'
            '如需用合成数据试跑，请在 medical-world-model 目录先执行：\n'
            '  python -m scripts.synthetic --patients 160\n'
            '合成数据仅用于验证训练流程，不是真实临床数据。\n'
            '已有真实数据时，请用 --events /实际路径/events.parquet 指定。'
        )


def main(argv=None, logdir=RUNS):
    p = parser()
    a = p.parse_args(argv)
    if min(a.epochs, a.batch, a.hidden, a.horizon) <= 0:
        p.error('epochs, batch, hidden and horizon must be positive')
    if a.check_device:
        try:
            device = resolve_device(a.device)
            print(f'device={device} precision={resolve_precision(device, a.precision)}', flush=True)
        except ValueError as exc:
            p.error(str(exc))
        return
    record = RunRecord(vars(a), logdir)
    try:
        train(a, record)
        record.finish('finished')
    except KeyboardInterrupt:
        record.finish('interrupted', '训练已由终端中断')
        raise
    except Exception as exc:
        record.finish('failed', f'{type(exc).__name__}: {exc}')
        raise


def train(a, record):
    validate_events(a.events)
    device = resolve_device(a.device)
    precision = resolve_precision(device, a.precision)
    record.update(device=device, precision=precision)
    record.log(f'device={device} precision={precision} torch={torch.__version__}')
    torch.manual_seed(42)
    np.random.seed(42)
    tr = DatasetWindows(a.events, horizon=a.horizon)
    va = DatasetWindows(a.events, 'val', horizon=a.horizon, stats=tr.stats)
    if not len(va):
        raise ValueError('Empty validation set')
    model = WorldModel(hidden=a.hidden).to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=3e-4)
    best = float('inf')
    out = Path(a.out)
    out.mkdir(exist_ok=True, parents=True)
    loader = DataLoader(tr, batch_size=a.batch, shuffle=True)
    record.update(train_windows=len(tr), val_windows=len(va), batches=len(loader))
    trained_samples = 0
    peak_memory = None
    if device == 'cuda':
        torch.cuda.reset_peak_memory_stats()
    for epoch in range(1, a.epochs + 1):
        started = time.monotonic()
        model.train()
        total_train = count_train = 0.
        last_report = time.monotonic()
        report_samples = report_steps = 0
        record.update(epoch=epoch, batch=0, phase='训练')
        for index, batch in enumerate(loader, 1):
            x, m, dt, fdt, y, ym = [v.to(device) for v in batch]
            observed = ym.sum().item()
            if observed:
                opt.zero_grad(set_to_none=True)
                with (torch.autocast('cuda', dtype=torch.bfloat16) if precision == 'bf16' else nullcontext()):
                    mu, lv = model(x, m, dt, fdt)
                    loss = nll(mu, lv, y, ym)
                if not torch.isfinite(loss).item():
                    raise ValueError('Non-finite training loss')
                loss.backward()
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.)
                opt.step()
                total_train += loss.item() * observed
                count_train += observed
            trained_samples += len(x)
            report_samples += len(x)
            report_steps += 1
            if time.monotonic() - last_report >= 1 or index == len(loader):
                record.update(batch=index, train_loss=total_train / count_train if count_train else None)
                elapsed = max(time.monotonic() - last_report, 1e-9)
                if device == 'cuda':
                    peak_memory = torch.cuda.max_memory_allocated() / 1e9
                elif device == 'mps':
                    peak_memory = max(peak_memory or 0, torch.mps.current_allocated_memory() / 1e9)
                record.event('train', iteration=(epoch-1)*len(loader)+index, epoch=epoch,
                             train_loss=total_train/count_train if count_train else None,
                             learning_rate=opt.param_groups[0]['lr'],
                             samples_per_second=report_samples/elapsed,
                             iterations_per_second=report_steps/elapsed,
                             trained_samples=trained_samples, peak_memory=peak_memory)
                report_samples = report_steps = 0
                last_report = time.monotonic()
        if not count_train:
            raise ValueError('Training has no observed targets')
        model.eval()
        record.update(phase='验证')
        validation_started = time.monotonic()
        total = count = 0.
        with torch.no_grad():
            for batch in DataLoader(va, batch_size=a.batch):
                x, m, dt, fdt, y, ym = [v.to(device) for v in batch]
                mu, lv = model(x, m, dt, fdt)
                total += (nll(mu, lv, y, ym) * ym.sum()).item()
                count += ym.sum().item()
        if count == 0 or not np.isfinite(total):
            raise ValueError('Validation has no observed targets or non-finite loss')
        score = total / count
        record.event('val', iteration=epoch*len(loader), epoch=epoch,
                     val_loss=score, val_time=time.monotonic()-validation_started)
        if score < best:
            best = score
            torch.save({'weights': {k: v.detach().cpu() for k, v in model.state_dict().items()},
                        'stats': tr.stats, 'hidden': a.hidden, 'horizon': a.horizon}, out / 'best.pt')
            record.update(checkpoint=str((out / 'best.pt').resolve()))
        row = dict(epoch=epoch, train_loss=total_train / count_train, val_loss=score,
                   seconds=time.monotonic() - started)
        record.data['history'].append(row)
        record.update(best_val_nll=best, phase='Epoch 完成')
        record.log(f'epoch={epoch}/{a.epochs} train_nll={row["train_loss"]:.5f} val_nll={score:.5f} seconds={row["seconds"]:.2f}')
        (out / 'metrics.json').write_text(json.dumps(dict(best_val_nll=best, device=device,
            precision=precision, train_windows=len(tr), val_windows=len(va)), indent=2))
