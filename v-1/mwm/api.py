import os,torch
from fastapi import FastAPI,HTTPException
from pydantic import BaseModel
from mwm.core import WorldModel,FEATURES
app=FastAPI(title='Medical World Model Research API')
class Request(BaseModel):
 observations:list[list[float]]
 mask:list[list[float]]
 horizon:int=6
@app.post('/v1/world-model/predict')
def predict(req:Request):
 path=os.environ.get('MWM_CHECKPOINT','outputs/best.pt')
 try:
  c=torch.load(path,map_location='cpu',weights_only=False)
  if req.horizon<1 or req.horizon>24 or len(req.observations)!=24 or len(req.mask)!=24:raise ValueError('Require 24 historical hours and horizon 1..24')
  x=torch.tensor(req.observations,dtype=torch.float32);mask=torch.tensor(req.mask,dtype=torch.float32)
  if x.shape!=(24,7) or mask.shape!=(24,7):raise ValueError('Expected 24x7 inputs')
  mean=torch.tensor(c['stats']['mean']);std=torch.tensor(c['stats']['std']);x=((x-mean)/std).nan_to_num(0)
  model=WorldModel(hidden=c['hidden']);model.load_state_dict(c['weights']);model.eval()
  with torch.no_grad():mu,lv=model(x[None],mask[None],torch.ones(1,24,1),torch.ones(1,req.horizon,1))
  return {'features':FEATURES,'mean':(mu[0]*std+mean).tolist(),'std':(torch.exp(.5*lv[0])*std).tolist(),'research_only':True}
 except (ValueError,RuntimeError,FileNotFoundError) as e:raise HTTPException(400,str(e))
