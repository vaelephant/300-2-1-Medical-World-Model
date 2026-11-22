import argparse
import numpy as np,pandas as pd
from pathlib import Path
from mwm.core import FEATURES
p=argparse.ArgumentParser();p.add_argument('--patients',type=int,default=160);p.add_argument('--out',default='data/processed/events.parquet');a=p.parse_args()
r=np.random.default_rng(42);base=np.array([85,120,65,20,97,37,82.]);scale=np.array([12,15,9,4,2,.5,11]);rows=[]
for i in range(a.patients):
 x=base+r.normal(0,scale)
 for t in range(64):
  x=base+.92*(x-base)+r.normal(0,scale*.25)
  for j,f in enumerate(FEATURES):
   if r.random()>.15:rows.append((i+1,100000+i,t,f,float(x[j])))
f=Path(a.out);f.parent.mkdir(parents=True,exist_ok=True);pd.DataFrame(rows,columns=['subject_id','stay_id','hour','feature','value']).to_parquet(f,index=False);print('Saved',f)
