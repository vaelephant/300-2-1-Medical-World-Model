import torch
from mwm.core import WorldModel,nll
def test_shapes_and_backward():
 m=WorldModel();mu,lv=m(torch.zeros(2,24,7),torch.ones(2,24,7),torch.ones(2,24,1),torch.ones(2,6,1));assert mu.shape==(2,6,7)
 loss=nll(mu,lv,torch.ones_like(mu),torch.ones_like(mu));loss.backward();assert torch.isfinite(loss)
