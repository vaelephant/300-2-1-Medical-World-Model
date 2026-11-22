import pytest
import torch
from mwm.device import resolve_device, resolve_precision


@pytest.mark.parametrize('cuda,mps,expected', [(True, True, 'cuda'), (False, True, 'mps'), (False, False, 'cpu')])
def test_auto_priority(monkeypatch, cuda, mps, expected):
    monkeypatch.setattr(torch.cuda, 'is_available', lambda: cuda)
    monkeypatch.setattr(torch.backends.mps, 'is_available', lambda: mps)
    assert resolve_device('auto') == expected


@pytest.mark.parametrize('alias,backend', [('mac', 'mps'), ('gpu', 'cuda')])
def test_explicit_device_never_silently_falls_back(monkeypatch, alias, backend):
    module = torch.cuda if backend == 'cuda' else torch.backends.mps
    monkeypatch.setattr(module, 'is_available', lambda: False)
    with pytest.raises(ValueError):
        resolve_device(alias)
    monkeypatch.setattr(module, 'is_available', lambda: True)
    assert resolve_device(alias) == backend


def test_precision(monkeypatch):
    monkeypatch.setattr(torch.cuda, 'is_bf16_supported', lambda: False)
    assert resolve_precision('cuda', 'auto') == 'fp32'
    with pytest.raises(ValueError):
        resolve_precision('cuda', 'bf16')
    monkeypatch.setattr(torch.cuda, 'is_bf16_supported', lambda: True)
    assert resolve_precision('cuda', 'auto') == 'bf16'
    assert resolve_precision('cuda', 'fp32') == 'fp32'
    for device in ('mps', 'cpu'):
        assert resolve_precision(device, 'auto') == 'fp32'
        with pytest.raises(ValueError):
            resolve_precision(device, 'bf16')
