"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { fetchForecast, fetchPatient, fetchPatients, fetchSimulation } from "@/lib/api";
import type { ForecastResponse, PatientSummary, PatientTrajectory } from "@/lib/types";
import { FeatureChart, type ChartPoint } from "@/components/FeatureChart";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";

const features = [
  ["albumin", "Albumin 白蛋白", "g/L"], ["tumor_size_cm", "Tumor size 肿瘤直径", "cm"],
  ["afp", "AFP", "ng/mL"], ["platelet", "Platelet 血小板", "×10⁹/L"], ["tbil", "Total bilirubin 总胆红素", "μmol/L"],
];
const treatments = [["none", "无治疗"], ["ablation", "消融"], ["resection", "切除"], ["tace", "TACE"], ["tare", "TARE"], ["systemic", "系统治疗"], ["transplant", "移植"], ["palliative", "支持治疗"], ["other", "其他"]];

export function ForecastWorkbench({ simulation = false }: { simulation?: boolean }) {
  const search = useSearchParams();
  const [patients, setPatients] = useState<PatientSummary[]>([]);
  const [patientId, setPatientId] = useState(search.get("patient") ?? "");
  const [traj, setTraj] = useState<PatientTrajectory | null>(null);
  const [forecast, setForecast] = useState<ForecastResponse | null>(null);
  const [baseline, setBaseline] = useState<ForecastResponse | null>(null);
  const [horizon, setHorizon] = useState(4);
  const [contextLen, setContextLen] = useState(3);
  const [modality, setModality] = useState("tace");
  const [dose, setDose] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  useEffect(() => {
    let active = true;
    const pending = request;
    fetchPatients().then(list => {
      if (active) { setPatients(list); setPatientId(id => id || list[0]?.patient_id || ""); }
    }).catch(e => { if (active) setError(String(e)); });
    return () => { active = false; pending.current++; };
  }, []);
  useEffect(() => {
    if (!patientId) return;
    let active = true;
    fetchPatient(patientId).then(t => { if (active) setTraj(t); })
      .catch(e => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, [patientId]);

  function invalidate() { request.current++; setForecast(null); setBaseline(null); setError(null); setBusy(false); }
  const valid = Number.isInteger(horizon) && horizon >= 1 && horizon <= 12 && Number.isInteger(contextLen) && contextLen >= 1 && contextLen <= 24 && Number.isFinite(dose) && dose >= 0 && dose <= 1;
  async function run() {
    const token = ++request.current;
    setBusy(true); setError(null); setForecast(null); setBaseline(null);
    try {
      const base = await fetchForecast(patientId, horizon, contextLen);
      const result = simulation ? await fetchSimulation(patientId, horizon, contextLen, modality, dose) : base;
      if (token === request.current) { setForecast(result); setBaseline(simulation ? base : null); }
    } catch (e) { if (token === request.current) setError(String(e)); }
    finally { if (token === request.current) setBusy(false); }
  }
  const charts = useMemo(() => {
    if (!traj || traj.patient.patient_id !== patientId) return [];
    return features.map(([key, title, unit]) => {
      const points = new Map<number, ChartPoint>();
      traj.visits.forEach((v, i) => {
        const day = v.observation.days_from_index;
        const value = v.observation.missing_mask[key] ? null : v.observation.features[key];
        points.set(day, { day, ...(forecast && i >= forecast.context_len ? { observed: value } : { history: value }) });
      });
      if (forecast) {
        for (const p of forecast.predictions) points.set(p.days_from_index, { ...points.get(p.days_from_index), day: p.days_from_index, forecast: p.features[key] });
        for (const p of baseline?.predictions ?? []) points.set(p.days_from_index, { ...points.get(p.days_from_index), day: p.days_from_index, baseline: p.features[key] });
        const origin = traj.visits[forecast.context_len - 1].observation;
        const value = origin.missing_mask[key] ? null : origin.features[key];
        points.set(forecast.forecast_origin_day, { ...points.get(forecast.forecast_origin_day), day: forecast.forecast_origin_day, forecast: value, observed: value, ...(baseline ? { baseline: value } : {}) });
      }
      return { key, title, unit, data: [...points.values()].sort((a, b) => a.day - b.day) };
    });
  }, [traj, patientId, forecast, baseline]);

  return <div className="flex flex-col gap-6">
    <div><h1 className="font-serif text-3xl font-semibold">{simulation ? "Simulation · 治疗情景" : "World Model · 病程预测"}</h1>
      <p className="mt-2 text-sm text-muted-foreground">使用前 N 次随访作为输入；从第 N 次随访起预测。后续观测仅用于回顾比较，不参与本次预测。</p></div>
    {simulation && <Alert><AlertTitle>固定未来治疗条件实验</AlertTitle><AlertDescription>各预测步使用相同治疗类别与相对强度，并与延续上下文末次治疗比较。结果来自合成数据模型，不代表因果疗效或治疗建议。</AlertDescription></Alert>}
    {error && <Alert variant="destructive"><AlertTitle>请求失败</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
    <FieldGroup className="grid items-end gap-4 rounded-lg border bg-card p-4 sm:grid-cols-3">
      <Field><FieldLabel htmlFor="patient">Patient · 患者</FieldLabel><NativeSelect id="patient" value={patientId} onChange={e => { invalidate(); setTraj(null); setPatientId(e.target.value); }}>
        {!patients.length && <NativeSelectOption value="">加载患者…</NativeSelectOption>}
        {patientId && !patients.some(p => p.patient_id === patientId) && <NativeSelectOption value={patientId}>{patientId}</NativeSelectOption>}
        {patients.map(p => <NativeSelectOption key={p.patient_id} value={p.patient_id}>{p.patient_id}</NativeSelectOption>)}
      </NativeSelect></Field>
      <Field><FieldLabel htmlFor="context">Context · 输入随访数</FieldLabel><Input id="context" type="number" min={1} max={24} value={contextLen} onChange={e => { invalidate(); setContextLen(Number(e.target.value)); }} /></Field>
      <Field><FieldLabel htmlFor="horizon">Horizon · 预测步数</FieldLabel><Input id="horizon" type="number" min={1} max={12} value={horizon} onChange={e => { invalidate(); setHorizon(Number(e.target.value)); }} /></Field>
      {simulation && <><Field><FieldLabel htmlFor="treatment">未来治疗条件</FieldLabel><NativeSelect id="treatment" value={modality} onChange={e => { invalidate(); setModality(e.target.value); }}>{treatments.map(([value, label]) => <NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}</NativeSelect></Field>
      <Field><FieldLabel htmlFor="dose">相对强度 · 0–1</FieldLabel><Input id="dose" type="number" min={0} max={1} step={0.1} value={dose} onChange={e => { invalidate(); setDose(Number(e.target.value)); }} /></Field></>}
      <Button onClick={run} disabled={busy || !valid || !traj || traj.patient.patient_id !== patientId}>{busy ? "运行中…" : simulation ? "比较情景" : "运行预测"}</Button>
    </FieldGroup>
    {forecast && <p role="status" className="text-sm text-muted-foreground">输入 {forecast.context_len} 次随访 · 预测起点 Day {forecast.forecast_origin_day} · 步长 {forecast.step_days.toFixed(1)} 天 · {forecast.model_version}</p>}
    <div className="grid gap-4 lg:grid-cols-2">{charts.map(c => <FeatureChart key={c.key} title={c.title} unit={c.unit} data={c.data} comparison={simulation} />)}</div>
  </div>;
}
