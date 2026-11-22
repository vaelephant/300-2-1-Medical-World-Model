import argparse
from pathlib import Path
import duckdb
from mwm.core import ITEMS
p=argparse.ArgumentParser();p.add_argument('--root',required=True);p.add_argument('--out',default='data/processed/events.parquet');p.add_argument('--limit-stays',type=int,default=1000);a=p.parse_args()
root=Path(a.root);chart=root/'icu/chartevents.csv.gz';stays=root/'icu/icustays.csv.gz'
for f in (chart,stays):
 if not f.exists():raise FileNotFoundError(f)
out=Path(a.out);out.parent.mkdir(parents=True,exist_ok=True)
con=duckdb.connect();con.execute("SET memory_limit='8GB'");con.execute('SET threads=4')
con.execute('CREATE TEMP TABLE cohort AS SELECT subject_id,stay_id,intime,outtime FROM read_csv_auto(?,header=true) ORDER BY stay_id LIMIT ?', [str(stays),a.limit_stays])
case=' '.join(f"WHEN {k} THEN '{v}'" for k,v in ITEMS.items());ids=','.join(map(str,ITEMS))
# Only charted and stored observations available by end of each hour.
sql=f"""COPY (WITH e AS (SELECT c.subject_id,c.stay_id,c.itemid,c.valuenum,c.charttime,c.storetime,s.intime,s.outtime FROM read_csv_auto('{chart}',header=true) c JOIN cohort s USING(stay_id,subject_id) WHERE c.itemid IN ({ids}) AND c.valuenum IS NOT NULL), v AS (SELECT subject_id,stay_id,CAST(FLOOR(date_diff('second',intime,charttime)/3600.0) AS INTEGER) hour,CASE itemid {case} END feature,CAST(valuenum AS DOUBLE) value FROM e WHERE charttime>=intime AND charttime<outtime AND COALESCE(storetime,charttime)<=intime+(FLOOR(date_diff('second',intime,charttime)/3600.0)+1)*INTERVAL '1 hour') SELECT subject_id,stay_id,hour,feature,median(value) value FROM v WHERE hour BETWEEN 0 AND 167 GROUP BY 1,2,3,4) TO '{out}' (FORMAT PARQUET)"""
con.execute(sql);print('Saved',out)
