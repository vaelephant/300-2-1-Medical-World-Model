import numpy as np
import pandas as pd
import torch
from torch import nn
from torch.utils.data import Dataset
FEATURES=['hr','sbp','dbp','rr','spo2','temp','map']
ITEMS={220045:'hr',220179:'sbp',220180:'dbp',220210:'rr',220277:'spo2',223761:'temp',220052:'map'}
class DatasetWindows(Dataset):
 def __init__(self,path,split='train',history=24,horizon=6,stats=None):
  df=pd.read_parquet(path); ids=np.array(sorted(df.subject_id.unique()));np.random.default_rng(42).shuffle(ids)
  n=len(ids); a=int(n*.7);b=int(n*.85);allowed={'train':ids[:a],'val':ids[a:b],'test':ids[b:]}[split]
  df=df[df.subject_id.isin(allowed)];self.arr=[];self.index=[];self.h=history;self.k=horizon
  for _,g in df.groupby('stay_id'):
   z=g.pivot_table(index='hour',columns='feature',values='value',aggfunc='median')
   z=z.reindex(range(int(z.index.min()),int(z.index.max())+1)).reindex(columns=FEATURES)
   if len(z)>=history+horizon:self.arr.append(z.to_numpy(dtype=np.float32))
  if stats is None:
   if split!='train':raise ValueError('Training stats required')
   if not self.arr:raise ValueError('No eligible training stays')
   x=np.concatenate(self.arr);mean=np.nanmean(x,0);std=np.nanstd(x,0)
   self.stats={'mean':np.nan_to_num(mean).tolist(),'std':np.where(np.isfinite(std)&(std>1e-5),std,1).tolist()}
  else:self.stats=stats
  for i,z in enumerate(self.arr):
   for t in range(0,len(z)-history-horizon+1,6):self.index.append((i,t))
 def __len__(self):return len(self.index)
 def __getitem__(self,i):
  j,t=self.index[i];x=self.arr[j][t:t+self.h+self.k];m=np.isfinite(x).astype('float32')
  x=np.where(np.isfinite(x),(x-np.array(self.stats['mean']))/np.array(self.stats['std']),0).astype('float32')
  h=self.h;k=self.k
  return tuple(torch.tensor(z,dtype=torch.float32) for z in (x[:h],m[:h],np.ones((h,1)),np.ones((k,1)),x[h:],m[h:]))
class WorldModel(nn.Module):
 def __init__(self,features=7,hidden=128):
  super().__init__();self.enc=nn.GRU(features*2+1,hidden,2,batch_first=True)
  self.dyn=nn.Sequential(nn.Linear(hidden+1,hidden),nn.SiLU(),nn.Linear(hidden,hidden))
  self.head=nn.Linear(hidden,features*2)
 def forward(self,x,mask,dt,future_dt):
  _,s=self.enc(torch.cat([x*mask,mask,dt],-1));s=s[-1];mus=[];lvs=[]
  for t in range(future_dt.shape[1]):
   s=s+.1*self.dyn(torch.cat([s,future_dt[:,t]],-1));mu,lv=self.head(s).chunk(2,-1)
   mus.append(mu);lvs.append(lv.clamp(-8,5))
  return torch.stack(mus,1),torch.stack(lvs,1)
def nll(mu,lv,y,mask):return (.5*(lv+(mu-y).square()*torch.exp(-lv))*mask).sum()/mask.sum().clamp_min(1)
