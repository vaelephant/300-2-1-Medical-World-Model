"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { fetchForecast, fetchModelMeta, fetchPatient, fetchPatients, fetchSimulation } from "@/lib/api";
import type { ForecastResponse, PatientSummary, PatientTrajectory } from "@/lib/types";
import { demoCases, demoFeatures, treatmentLabels, type DemoCase } from "@/lib/demo-cases";
import { ChartLegend, FeatureChart, SCENARIO_COLORS, type ChartPoint } from "@/components/FeatureChart";
import { PatientTimeline } from "@/components/PatientTimeline";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell, TableCaption } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export type WorkbenchMode = "forecast" | "simulation";

type Scenario = { modality: string; dose: number };
type Result = { baseline: ForecastResponse; scenarios: { label: string; response: ForecastResponse }[] };

const MIN_SCENARIOS = 2;
const MAX_SCENARIOS = 3;
const DEFAULT_SCENARIOS = ["tace", "systemic"];
const SCENARIO_ADD_CANDIDATES = ["tace", "systemic", "none", "ablation", "resection", "tare", "palliative"];

function makeScenario(modality: string): Scenario {
  return { modality, dose: modality === "none" ? 0 : 1 };
}

function presetScenarios(treatments: string[]): Scenario[] {
  const list = treatments.slice(0, MAX_SCENARIOS).map(makeScenario);
  while (list.length < MIN_SCENARIOS) list.push(makeScenario("none"));
  return list;
}

/** 读取 URL 参数里的整数，越界或非法时返回 null（交给调用方回退默认值）。 */
function readIntParam(value: string | null, min: number, max: number): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function formatKpiValue(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })
    : "—";
}

export function ForecastWorkbench({ mode }: { mode: WorkbenchMode }) {
  const isForecast = mode === "forecast";
  const search = useSearchParams();
  const initialPatient = search.get("patient") ?? demoCases[0].patientId;
  const initialPreset = demoCases.find((item) => item.patientId === initialPatient);

  const [patients, setPatients] = useState<PatientSummary[]>([]);
  const [patientId, setPatientId] = useState(initialPatient);
  const [traj, setTraj] = useState<PatientTrajectory | null>(null);
  const [modelLimit, setModelLimit] = useState<number | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [horizon, setHorizon] = useState(
    readIntParam(search.get("horizon"), 1, 12) ?? initialPreset?.horizon ?? 4,
  );
  const [contextLen, setContextLen] = useState(
    readIntParam(search.get("context"), 1, 24) ?? initialPreset?.context ?? 3,
  );
  const [scenarios, setScenarios] = useState<Scenario[]>(() =>
    presetScenarios(initialPreset?.treatments ?? DEFAULT_SCENARIOS),
  );
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const resultsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    const pending = request;
    Promise.all([fetchPatients(), fetchModelMeta()])
      .then(([list, meta]) => {
        if (active) {
          setPatients(list);
          setModelLimit(Number(meta.config.max_visits) || 12);
        }
      })
      .catch((err) => {
        if (active) setError(String(err));
      });
    return () => {
      active = false;
      pending.current++;
    };
  }, []);

  useEffect(() => {
    let active = true;
    fetchPatient(patientId)
      .then((loaded) => {
        if (active) setTraj(loaded);
      })
      .catch((err) => {
        if (active) setError(String(err));
      });
    return () => {
      active = false;
    };
  }, [patientId]);

  // 运行预测/比较成功后把结果区滚入视野（仅在客户端 effect 中访问 DOM，SSR 安全）。
  useEffect(() => {
    if (!result) return;
    const element = resultsRef.current;
    if (!element) return;
    const reducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
  }, [result]);

  function invalidate() {
    request.current++;
    setResult(null);
    setRevealed(false);
    setError(null);
    setBusy(false);
  }

  function resetForPatient(id: string) {
    const preset = demoCases.find((item) => item.patientId === id);
    invalidate();
    setTraj(null);
    setPatientId(id);
    setContextLen(preset?.context ?? 3);
    setHorizon(preset?.horizon ?? 4);
    setScenarios(presetScenarios(preset?.treatments ?? DEFAULT_SCENARIOS));
  }

  function loadCase(item: DemoCase) {
    invalidate();
    if (patientId !== item.patientId) setTraj(null);
    setPatientId(item.patientId);
    setContextLen(item.context);
    setHorizon(item.horizon);
    setScenarios(presetScenarios(item.treatments));
  }

  function updateScenario(index: number, change: Partial<Scenario>) {
    invalidate();
    setScenarios((current) => current.map((scenario, i) => (i === index ? { ...scenario, ...change } : scenario)));
  }

  function addScenario() {
    if (scenarios.length >= MAX_SCENARIOS) return;
    invalidate();
    setScenarios((current) => {
      if (current.length >= MAX_SCENARIOS) return current;
      const used = new Set(current.map((scenario) => scenario.modality));
      const modality = SCENARIO_ADD_CANDIDATES.find((item) => !used.has(item)) ?? "none";
      return [...current, makeScenario(modality)];
    });
  }

  function removeScenario(index: number) {
    if (scenarios.length <= MIN_SCENARIOS) return;
    invalidate();
    setScenarios((current) => (current.length <= MIN_SCENARIOS ? current : current.filter((_, i) => i !== index)));
  }

  const ready = traj?.patient.patient_id === patientId && modelLimit !== null;
  const maxContext = Math.min(traj?.visits.length ?? 0, modelLimit ?? 0, 24);
  const context = Math.min(contextLen, maxContext);
  const valid =
    context > 0 &&
    Number.isInteger(horizon) &&
    horizon >= 1 &&
    horizon <= 12 &&
    scenarios.every((scenario) => Number.isFinite(scenario.dose) && scenario.dose >= 0 && scenario.dose <= 1);

  async function run() {
    const compare = !isForecast;
    const token = ++request.current;
    setBusy(true);
    setError(null);
    setResult(null);
    setRevealed(false);
    try {
      const baseline = await fetchForecast(patientId, horizon, context);
      const comparisons = compare
        ? await Promise.all(
            scenarios.map(async (scenario, index) => ({
              label: `情景 ${index + 1} · ${treatmentLabels[scenario.modality]}（强度 ${scenario.dose}）`,
              response: await fetchSimulation(patientId, horizon, context, scenario.modality, scenario.dose),
            })),
          )
        : [];
      if (
        comparisons.some(
          (item) =>
            item.response.forecast_origin_day !== baseline.forecast_origin_day ||
            item.response.context_len !== baseline.context_len ||
            item.response.step_days !== baseline.step_days ||
            item.response.model_version !== baseline.model_version,
        )
      ) {
        throw new Error("情景与基线版本或起点不一致，请重新运行");
      }
      if (token === request.current) setResult({ baseline, scenarios: comparisons });
    } catch (err) {
      if (token === request.current) setError(String(err));
    } finally {
      if (token === request.current) setBusy(false);
    }
  }

  const origin = ready && context > 0 ? traj!.visits[context - 1].observation.days_from_index : undefined;

  const charts = useMemo(() => {
    if (!traj || !ready) return [];
    return demoFeatures.map((feature) => {
      const points = new Map<number, ChartPoint>();
      traj.visits.forEach((visit, index) => {
        if (index >= context && !revealed) return;
        const day = visit.observation.days_from_index;
        const value = visit.observation.missing_mask[feature.key] ? null : visit.observation.features[feature.key];
        points.set(day, { day, ...(index >= context ? { observed: value } : { history: value }) });
      });
      if (result) {
        const series = [
          { key: "forecast", response: result.baseline },
          ...result.scenarios.map((scenario, index) => ({ key: `scenario${index}`, response: scenario.response })),
        ];
        const observedVisit = traj.visits[result.baseline.context_len - 1].observation;
        const observedValue = observedVisit.missing_mask[feature.key] ? null : observedVisit.features[feature.key];
        for (const { key, response } of series) {
          for (const prediction of response.predictions) {
            points.set(prediction.days_from_index, {
              ...points.get(prediction.days_from_index),
              day: prediction.days_from_index,
              [key]: prediction.features[feature.key],
            });
          }
          points.set(observedVisit.days_from_index, {
            ...points.get(observedVisit.days_from_index),
            day: observedVisit.days_from_index,
            [key]: observedValue,
            ...(revealed ? { observed: observedValue } : {}),
          });
        }
      }
      return { ...feature, data: [...points.values()].sort((a, b) => a.day - b.day) };
    });
  }, [traj, ready, context, revealed, result]);

  const preset = demoCases.find((item) => item.patientId === patientId);
  const contextValue = context || contextLen;
  const forecastHref = useMemo(
    () => `/world-model?patient=${encodeURIComponent(patientId)}&context=${contextValue}&horizon=${horizon}`,
    [patientId, contextValue, horizon],
  );
  const simulationHref = useMemo(
    () => `/simulation?patient=${encodeURIComponent(patientId)}&context=${contextValue}&horizon=${horizon}`,
    [patientId, contextValue, horizon],
  );
  const resultRows = result
    ? [
        { label: "基线 · 延续原条件", color: "var(--chart-forecast)", response: result.baseline },
        ...result.scenarios.map((scenario, index) => ({
          label: scenario.label,
          color: SCENARIO_COLORS[index % SCENARIO_COLORS.length],
          response: scenario.response,
        })),
      ]
    : [];

  const chartScenarios = useMemo(
    () =>
      result?.scenarios.map((scenario, index) => ({
        key: `scenario${index}`,
        label: scenario.label,
        color: SCENARIO_COLORS[index % SCENARIO_COLORS.length],
      })) ?? [],
    [result],
  );

  // 末步 KPI：基线预测末步值 + 相对“输入末次观测”的 Δ（仅用 ForecastResponse 与当前 trajectory）。
  const lastStepKpis = useMemo(() => {
    if (!result || !traj) return [];
    const lastPrediction = result.baseline.predictions.at(-1);
    const inputVisit = traj.visits[result.baseline.context_len - 1];
    if (!lastPrediction || !inputVisit) return [];
    return demoFeatures.map((feature) => {
      const predicted = lastPrediction.features[feature.key];
      const observed = inputVisit.observation.missing_mask[feature.key]
        ? null
        : inputVisit.observation.features[feature.key];
      const hasPredicted = typeof predicted === "number" && Number.isFinite(predicted);
      const hasObserved = typeof observed === "number" && Number.isFinite(observed);
      return {
        key: feature.key,
        title: feature.title,
        unit: feature.unit,
        predicted: hasPredicted ? predicted : null,
        delta: hasPredicted && hasObserved ? predicted - observed : null,
      };
    });
  }, [result, traj]);

  return (
    <div className="flex w-full flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-serif text-3xl font-semibold tracking-tight">
            {isForecast ? "World Model · 病程预测" : "Simulation · 治疗情景对比"}
          </h1>
          <p className="mt-1.5 max-w-3xl text-sm text-muted-foreground">
            {isForecast
              ? "选病例 → 看病程 → 定起点 → 做预测。预测完成后进入治疗情景页，在同一起点、同一跨度下比较模型响应。"
              : "同一起点、同一预测跨度下比较基线与 2–3 个未来治疗条件。仅展示合成模型响应，不排序、不推荐最优治疗。"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isForecast ? (
            <Link href="/patients" className={buttonVariants({ variant: "outline" })}>
              浏览其他患者
            </Link>
          ) : (
            <Link href={forecastHref} className={buttonVariants({ variant: "outline" })}>
              返回调整预测起点
            </Link>
          )}
          <Link href="/evaluation" className={buttonVariants({ variant: "outline" })}>
            查看整体评估
          </Link>
        </div>
      </header>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>请求失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {isForecast ? (
        <section className="flex flex-col gap-3" aria-label="精选演示病例">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold">01 · 精选演示病例</h2>
            <p className="text-xs text-muted-foreground">
              按分期、治疗记录与轨迹形态人工挑选，不按预测效果筛选；仅用于演示，不代表整体模型性能。
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {demoCases.map((item) => {
              const active = item.patientId === patientId;
              return (
                <button
                  key={item.patientId}
                  type="button"
                  aria-pressed={active}
                  aria-label={`载入病例 ${item.patientId}`}
                  onClick={() => loadCase(item)}
                  className={cn(
                    "flex h-full flex-col gap-2 rounded-lg border p-3 text-left transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none",
                    active
                      ? "border-primary bg-primary-container/60"
                      : "border-outline-variant/60 bg-surface-lowest hover:bg-surface-low",
                  )}
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="text-sm leading-tight font-medium">{item.title}</span>
                    <span className="shrink-0 rounded-sm bg-surface-low px-1.5 py-0.5 text-[10px] text-on-surface-variant">
                      BCLC {item.stage}
                    </span>
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {item.patientId} · 第 {item.context} 次 → {item.horizon} 步 · {item.treatments.length} 情景
                  </span>
                  <span className="line-clamp-3 text-xs text-on-surface-variant">{item.reason}</span>
                  <span className="mt-auto text-xs font-medium text-primary">{active ? "已载入" : "载入病例"}</span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      <section
        className={cn(
          "flex flex-col gap-3",
          !isForecast && "rounded-lg border border-outline-variant/50 bg-surface-lowest p-4",
        )}
        aria-label="预测参数"
      >
        {!isForecast ? (
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-medium">已带入的预测条件</h2>
            <p className="text-xs text-muted-foreground">
              从病程预测页带入同一起点与跨度；需要重新选择时点请返回调整。
            </p>
          </div>
        ) : null}
        <FieldGroup className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field>
            <FieldLabel htmlFor="patient">Patient · 患者</FieldLabel>
            <NativeSelect id="patient" value={patientId} onChange={(event) => resetForPatient(event.target.value)}>
              {!patients.some((item) => item.patient_id === patientId) ? (
                <NativeSelectOption value={patientId}>{patientId}</NativeSelectOption>
              ) : null}
              {patients.map((item) => (
                <NativeSelectOption key={item.patient_id} value={item.patient_id}>
                  {item.patient_id}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="context">预测起点 · 随访时点</FieldLabel>
            <NativeSelect
              id="context"
              value={context || ""}
              disabled={!ready}
              onChange={(event) => {
                invalidate();
                setContextLen(Number(event.target.value));
              }}
            >
              {!ready ? <NativeSelectOption value="">加载随访…</NativeSelectOption> : null}
              {ready
                ? traj!.visits.slice(0, maxContext).map((visit, index) => (
                    <NativeSelectOption key={index} value={index + 1}>
                      第 {index + 1} 次 · Day {visit.observation.days_from_index}
                    </NativeSelectOption>
                  ))
                : null}
            </NativeSelect>
          </Field>
          <Field data-invalid={!Number.isInteger(horizon) || horizon < 1 || horizon > 12}>
            <FieldLabel htmlFor="horizon">预测未来步数 · 1–12</FieldLabel>
            <Input
              id="horizon"
              aria-invalid={!Number.isInteger(horizon) || horizon < 1 || horizon > 12}
              type="number"
              min={1}
              max={12}
              value={horizon}
              onChange={(event) => {
                invalidate();
                setHorizon(Number(event.target.value));
              }}
            />
          </Field>
        </FieldGroup>
        {ready ? (
          <p className="text-sm text-muted-foreground">
            {patientId} · {traj!.patient.sex === "male" ? "男" : traj!.patient.sex === "female" ? "女" : "性别未知"} ·{" "}
            {traj!.patient.age_at_index} 岁 · BCLC {traj!.patient.bclc_stage} · Child-Pugh {traj!.patient.child_pugh} ·{" "}
            {traj!.patient.etiology} · 诊断日 {traj!.patient.diagnosis_date}
            {preset ? " · 精选合成病例" : ""}
          </p>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            正在加载患者与模型信息…
          </p>
        )}
      </section>

      {isForecast && ready ? (
        <PatientTimeline
          trajectory={traj!}
          context={context}
          maxContext={maxContext}
          revealed={revealed}
          onSelect={(value) => {
            invalidate();
            setContextLen(value);
          }}
        />
      ) : null}

      {!isForecast ? (
        <section className="flex flex-col gap-4" aria-label="治疗情景">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold">04 · 治疗情景</h2>
            <p className="text-xs text-muted-foreground">基线之外支持同屏比较 2–3 个情景（当前 {scenarios.length} 个）。</p>
          </div>
          <Alert>
            <AlertTitle>同一起点 · 同一预测跨度</AlertTitle>
            <AlertDescription>
              基线 = 延续输入末次随访的治疗条件；情景 = 每个未来步都使用所选固定条件与相对强度。仅展示合成模型响应，不排序、不推荐最优治疗。
            </AlertDescription>
          </Alert>
          <FieldGroup className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {scenarios.map((scenario, index) => (
              <FieldGroup key={index} role="group" aria-label={`情景 ${index + 1}`} className="rounded-lg border p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <span
                      aria-hidden
                      className="inline-block size-2.5 rounded-full"
                      style={{ backgroundColor: SCENARIO_COLORS[index % SCENARIO_COLORS.length] }}
                    />
                    情景 {index + 1}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy || scenarios.length <= MIN_SCENARIOS}
                    onClick={() => removeScenario(index)}
                    aria-label={`移除情景 ${index + 1}`}
                  >
                    移除
                  </Button>
                </div>
                <Field>
                  <FieldLabel htmlFor={`treatment-${index}`}>未来治疗条件</FieldLabel>
                  <NativeSelect
                    id={`treatment-${index}`}
                    value={scenario.modality}
                    onChange={(event) =>
                      updateScenario(index, {
                        modality: event.target.value,
                        dose: event.target.value === "none" ? 0 : 1,
                      })
                    }
                  >
                    {Object.entries(treatmentLabels).map(([value, label]) => (
                      <NativeSelectOption key={value} value={value}>
                        {label}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
                <Field data-invalid={!Number.isFinite(scenario.dose) || scenario.dose < 0 || scenario.dose > 1}>
                  <FieldLabel htmlFor={`dose-${index}`}>相对强度 0–1</FieldLabel>
                  <Input
                    id={`dose-${index}`}
                    type="number"
                    min={0}
                    max={1}
                    step={0.1}
                    value={scenario.dose}
                    aria-invalid={!Number.isFinite(scenario.dose) || scenario.dose < 0 || scenario.dose > 1}
                    onChange={(event) => updateScenario(index, { dose: Number(event.target.value) })}
                  />
                </Field>
              </FieldGroup>
            ))}
          </FieldGroup>
          <div>
            <Button variant="outline" onClick={addScenario} disabled={busy || scenarios.length >= MAX_SCENARIOS}>
              + 添加情景
            </Button>
          </div>
        </section>
      ) : null}

      <section className="flex flex-col gap-4" aria-label="预测与情景比较结果">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{isForecast ? "03 · 预测结果" : "05 · 比较结果与回顾对照"}</h2>
          <div className="flex flex-wrap gap-3">
            {isForecast ? (
              <Button onClick={run} disabled={busy || !ready || !valid}>
                {busy ? "计算中…" : "运行病程预测"}
              </Button>
            ) : (
              <>
                <Button onClick={run} disabled={busy || !ready || !valid}>
                  {busy ? "计算中…" : `比较基线与 ${scenarios.length} 个情景`}
                </Button>
                <Button variant="outline" disabled={!result || busy} onClick={() => setRevealed((value) => !value)}>
                  {revealed ? "隐藏后续观测" : "揭示后续观测"}
                </Button>
              </>
            )}
          </div>
        </div>
        {ready && !valid ? (
          <p role="status" className="text-sm text-error">
            参数需满足：预测起点至少 1 次随访，未来步数 1–12，相对强度 0–1。
          </p>
        ) : null}

        <div ref={resultsRef} className="flex min-w-0 scroll-mt-4 flex-col gap-4">
          {result ? (
            <p role="status" className="text-sm text-muted-foreground">
              输入 {result.baseline.context_len} 次随访 · 预测起点 Day {result.baseline.forecast_origin_day} · 预测{" "}
              {result.baseline.prediction_horizon} 步 · 步长 {result.baseline.step_days.toFixed(1)} 天 ·{" "}
              {result.baseline.model_version}
              {result.scenarios.length ? ` · 比较 ${result.scenarios.length} 个情景` : ""}
            </p>
          ) : null}
          {result ? (
            <section className="flex flex-col gap-2" aria-label="预测末步 KPI">
              <p className="text-xs font-medium text-on-surface-variant">
                末步预测概览 · Day{" "}
                {result.baseline.predictions.at(-1)!.days_from_index.toFixed(1)}（基线 · 延续原条件）
              </p>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {lastStepKpis.map((kpi) => (
                  <div
                    key={kpi.key}
                    className="rounded-lg border border-outline-variant/50 bg-surface-lowest px-3 py-2.5"
                  >
                    <p className="text-xs text-on-surface-variant">
                      {kpi.title}
                      <span className="ml-1 text-muted-foreground">({kpi.unit})</span>
                    </p>
                    <p className="mt-1 text-xl font-semibold tabular-nums text-on-surface">
                      {formatKpiValue(kpi.predicted)}
                    </p>
                    {kpi.delta === null ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        <span aria-hidden="true" className="mr-1">
                          →
                        </span>
                        Δ —（输入末次观测未采集）
                      </p>
                    ) : (
                      <p
                        className={cn(
                          "mt-0.5 inline-flex items-center gap-1 text-xs font-medium tabular-nums",
                          kpi.delta > 0
                            ? "text-warning"
                            : kpi.delta < 0
                              ? "text-tertiary"
                              : "text-muted-foreground",
                        )}
                      >
                        <span aria-hidden="true">
                          {kpi.delta > 0 ? "↑" : kpi.delta < 0 ? "↓" : "→"}
                        </span>
                        <span>
                          Δ {kpi.delta > 0 ? "+" : ""}
                          {formatKpiValue(kpi.delta)} {kpi.unit}
                        </span>
                      </p>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Δ = 末步预测 − 输入末次观测；仅描述合成模型输出，不代表疗效，模型未提供置信区间。
              </p>
            </section>
          ) : null}
          {revealed ? (
            <Alert>
              <AlertTitle>回顾对照，不是替代情景验证</AlertTitle>
              <AlertDescription>
                灰色曲线为原合成轨迹的后续观测，实际随访日期可能与预测网格不同。后续实际治疗可能变化，不能用这条轨迹证明替代治疗有效，也不能直接把不同时点相减作为预测误差。
              </AlertDescription>
            </Alert>
          ) : null}
          {charts.length > 0 ? (
            <div className="flex min-w-0 flex-col gap-2">
              <ChartLegend
                showBaseline={Boolean(result)}
                baselineLabel="基线 · 延续原条件"
                revealed={revealed}
                scenarios={chartScenarios}
              />
              <div className="grid min-w-0 gap-4 lg:grid-cols-2">
                {charts.map((chart, index) => (
                  <FeatureChart
                    key={chart.key}
                    title={chart.title}
                    unit={chart.unit}
                    data={chart.data}
                    originDay={origin}
                    showOriginLabel={index === 0}
                    syncId="feature-chart-sync"
                    forecastLabel="基线 · 延续原条件"
                    scenarios={chartScenarios}
                  />
                ))}
              </div>
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-outline-variant/60 bg-surface-lowest px-4 py-6 text-sm text-muted-foreground">
              选择预测起点后运行{isForecast ? "病程预测" : "情景比较"}，四张指标图会在这里出现。
            </p>
          )}
          {result ? (
            <section className="flex min-w-0 flex-col gap-3">
              <h3 className="text-base font-semibold">
                预测末步结果 · Day {result.baseline.predictions.at(-1)!.days_from_index.toFixed(1)}
              </h3>
              <Table>
                <TableCaption>
                  相同时间点的模型输出，按输入情景顺序展示，不表示疗效排名。相对强度不是临床剂量。
                </TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>条件</TableHead>
                    {demoFeatures.map((feature) => (
                      <TableHead key={feature.key}>
                        {feature.title} {feature.unit}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {resultRows.map((row) => (
                    <TableRow key={row.label}>
                      <TableCell>
                        <span
                          aria-hidden
                          className="mr-2 inline-block size-2.5 rounded-full align-middle"
                          style={{ backgroundColor: row.color }}
                        />
                        {row.label}
                      </TableCell>
                      {demoFeatures.map((feature) => (
                        <TableCell key={feature.key}>
                          {row.response.predictions.at(-1)!.features[feature.key].toLocaleString("zh-CN", {
                            maximumFractionDigits: 2,
                          })}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            {isForecast ? (
              <>
                <Link
                  href={simulationHref}
                  className={cn(buttonVariants(), !result && "pointer-events-none opacity-50")}
                  aria-disabled={!result}
                >
                  下一步 · 比较治疗情景
                </Link>
                <p className="text-sm text-muted-foreground">
                  已带入当前患者、预测起点与步数，进入后可直接比较 2–3 个未来治疗条件。
                </p>
              </>
            ) : (
              <>
                <Link href={forecastHref} className={buttonVariants({ variant: "outline" })}>
                  返回调整预测起点
                </Link>
                <Link href="/evaluation" className={buttonVariants({ variant: "outline" })}>
                  查看整体评估证据
                </Link>
                <p className="text-sm text-muted-foreground">病例展示与测试集指标分开解读。</p>
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
