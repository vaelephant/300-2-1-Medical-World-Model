"""Shared training device and precision selection."""
import torch


def resolve_device(requested):
    requested = {'mac': 'mps', 'gpu': 'cuda'}.get(requested, requested)
    if requested == 'auto':
        requested = ('cuda' if torch.cuda.is_available() else
                     'mps' if torch.backends.mps.is_available() else 'cpu')
    if requested == 'cuda' and not torch.cuda.is_available():
        raise ValueError('CUDA unavailable: requires NVIDIA GPU and CUDA-enabled PyTorch; or use --device cpu')
    if requested == 'mps' and not torch.backends.mps.is_available():
        raise ValueError('MPS unavailable: requires a supported Mac and MPS-enabled PyTorch; or use --device cpu')
    if requested not in {'cpu', 'mps', 'cuda'}:
        raise ValueError(f'Unknown device: {requested}')
    return requested


def resolve_precision(device, requested):
    supported = device == 'cuda' and torch.cuda.is_bf16_supported()
    if requested == 'bf16' and not supported:
        raise ValueError('BF16 requires a supported CUDA GPU; use --precision fp32')
    return 'bf16' if supported and requested != 'fp32' else 'fp32'
