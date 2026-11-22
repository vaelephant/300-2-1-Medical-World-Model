import argparse,json,torch
from torch.utils.data import DataLoader
from mwm.core import DatasetWindows,WorldModel
p=argparse.ArgumentParser();p.add_argument('--events',default='data/processed/events.parquet');p.add_argument('--checkpoint',default='outputs/best.pt');a=p.parse_args()
c=torch.load(a.checkpoint,map_location='cpu',weights_only=False);ds=DatasetWindows(a.events,'test',horizon=c['horizon'],stats=c['stats']);m=WorldModel(hidden=c['hidden']);m.load_state_dict(c['weights']);m.eval();s=torch.zeros(c['horizon']);n=torch.zeros_like(s)
with torch.no_grad():
 for x,mask,dt,fdt,y,ym in DataLoader(ds,batch_size=64):
  mu,_=m(x,mask,dt,fdt);s+=((mu-y).abs()*ym).sum((0,2));n+=ym.sum((0,2))
print(json.dumps({'test_mae_normalized_per_hour':(s/n.clamp_min(1)).tolist(),'windows':len(ds)},indent=2))
