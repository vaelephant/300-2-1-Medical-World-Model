"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { fetchLatent, fetchPatients } from "@/lib/api";
import type { LatentResponse, PatientSummary } from "@/lib/types";
import { demoCases } from "@/lib/demo-cases";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { LatentScatter } from "@/components/latent/LatentScatter";
import {
  findCohortPoint,
  formatDays,
  formatNumber,
  formatPercent,
  formatSex,
} from "@/components/latent/latentUtils";

const DEFAULT_PATIENT = demoCases[0]?.patientId ?? "SYN00733";
const DEFAULT_HORIZON = 3;
const HORIZON_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function KpiCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-outline-variant/50 bg-surface-lowest px-4 py-3">
      <p className="text-xs text-on-surface-variant">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

/** /latent 潜在空间：队列 PCA 投影 + 单患者 observed/forecast latent 路径。 */
export function LatentExplorer() {
  const [patientId, setPatientId] = useState(DEFAULT_PATIENT);
  const [horizon, setHorizon] = useState<number>(DEFAULT_HORIZON);
  const [data, setData] = useState<LatentResponse | null>(null);
  const [patientOptions, setPatientOptions] = useState<PatientSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const requestRef = useRef(0);

  // 患者下拉：只加载前 500 位；当前患者即使不在其中也会被补进选项。
  useEffect(() => {
    let active = true;
    fetchPatients(500)
      .then((list) => {
        if (active) setPatientOptions(list);
      })
      .catch(() => {
        if (active) setPatientOptions(null);
      });
    return () => {
      active = false;
    };
  }, []);

  // 切换患者 / horizon / 刷新时重新拉取；保留旧图直到新数据到达。
  useEffect(() => {
    const token = requestRef.current + 1;
    requestRef.current = token;
    fetchLatent(patientId, horizon)
      .then((response) => {
        if (token !== requestRef.current) return;
        setData(response);
        setError(null);
      })
      .catch((cause) => {
        if (token !== requestRef.current) return;
        setError(toMessage(cause));
      })
      .finally(() => {
        if (token === requestRef.current) setLoading(false);
      });
    return () => {
      // 卸载或重新请求时让旧结果失效。
      requestRef.current += 1;
    };
  }, [patientId, horizon, version]);

  const selectPatient = useCallback(
    (nextId: string) => {
      if (nextId === patientId) return;
      setLoading(true);
      setPatientId(nextId);
    },
    [patientId],
  );

  const changeHorizon = useCallback(
    (nextHorizon: number) => {
      if (nextHorizon === horizon) return;
      setLoading(true);
      setHorizon(nextHorizon);
    },
    [horizon],
  );

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    setVersion((value) => value + 1);
  }, []);

  const patientIds = useMemo(() => {
    const fromList = patientOptions?.map((patient) => patient.patient_id) ?? [];
    const fromCohort = data?.cohort?.map((point) => point.patient_id) ?? [];
    const source = fromList.length > 0 ? fromList : fromCohort;
    const unique = Array.from(new Set(source));
    if (patientId && !unique.includes(patientId)) unique.unshift(patientId);
    return unique;
  }, [patientOptions, data, patientId]);

  const cohort = useMemo(() => data?.cohort ?? [], [data]);
  const observed = useMemo(() => data?.observed ?? [], [data]);
  const forecast = useMemo(() => data?.forecast ?? [], [data]);
  const activePatientId = data?.patient_id ?? patientId;
  const selectedPoint = useMemo(
    () => findCohortPoint(cohort, activePatientId),
    [cohort, activePatientId],
  );

  const pca = data?.pca;
  const pc1 = pca?.explained_variance?.[0];
  const pc2 = pca?.explained_variance?.[1];
  const cumulative =
    typeof pc1 === "number" && typeof pc2 === "number" ? pc1 + pc2 : undefined;
  const horizonSteps = data?.horizon ?? horizon;

  return (
    <div className="flex w-full flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-serif text-3xl font-semibold tracking-tight">
            Latent · 潜在空间
          </h1>
          <p className="mt-1.5 max-w-3xl text-sm text-muted-foreground">
            PCA 投影自 encoder latent，两个坐标轴没有临床含义，不是生物标志物或风险预测；
            forecast 是末次治疗条件 + 平均步长的 latent rollout，只展示模型内部状态走向，
            不代表疗效或真实临床轨迹。点击队列散点可切换患者。
          </p>
        </div>
        <Button variant="outline" onClick={refresh} disabled={loading}>
          {loading ? "刷新中…" : "刷新"}
        </Button>
      </header>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>潜在空间数据读取失败</AlertTitle>
          <AlertDescription>
            {error}
            <span className="mt-1 block text-xs">
              确认本地 API 已启动（scripts/serve_api.py），且
              /api/v1/latent/&lt;patient_id&gt; 可访问。
            </span>
          </AlertDescription>
        </Alert>
      ) : null}
      {!data && loading ? (
        <p role="status" className="text-sm text-muted-foreground">
          正在读取潜在空间（队列 PCA + 患者路径，约 170KB）…
        </p>
      ) : null}
      {data?.available === false ? (
        <Alert>
          <AlertTitle>潜在空间不可用</AlertTitle>
          <AlertDescription>
            {data.message ?? "API 未返回可用 latent 数据；页面不会用占位坐标代替。"}
          </AlertDescription>
        </Alert>
      ) : null}

      {data && data.available !== false ? (
        <>
          <section
            aria-label="潜在空间控件"
            className="rounded-lg border border-outline-variant/50 bg-surface-lowest p-4"
          >
            <div className="grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                患者（前 500 位；当前患者始终可选）
                <NativeSelect
                  value={patientId}
                  onChange={(event) => selectPatient(event.target.value)}
                >
                  {patientIds.map((id) => (
                    <NativeSelectOption key={id} value={id}>
                      {id}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                forecast 步数 horizon（1–8）
                <NativeSelect
                  value={String(horizon)}
                  onChange={(event) => changeHorizon(Number(event.target.value))}
                >
                  {HORIZON_OPTIONS.map((value) => (
                    <NativeSelectOption key={value} value={String(value)}>
                      horizon = {value} 步
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </label>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {loading ? (
                  <span role="status" className="text-muted-foreground">
                    正在加载…
                  </span>
                ) : (
                  <span>当前：{activePatientId}</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                切换患者 / horizon 会重新拉取 latent 与 1000 点队列（服务端缓存 PCA，约 0.2–1.2s）。
              </p>
            </div>
          </section>

          <section aria-label="潜在空间 KPI" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <KpiCard
              label="队列患者数"
              value={formatNumber(cohort.length, 0)}
              hint={pca?.n_patients != null ? `PCA 覆盖 ${formatNumber(pca.n_patients, 0)} 位` : undefined}
            />
            <KpiCard
              label="PC1 解释方差"
              value={formatPercent(pc1)}
              hint={cumulative != null ? `PC1+PC2 = ${formatPercent(cumulative)}` : undefined}
            />
            <KpiCard label="PC2 解释方差" value={formatPercent(pc2)} />
            <KpiCard
              label="当前患者随访数"
              value={formatNumber(observed.length, 0)}
              hint={selectedPoint?.n_visits != null ? `cohort n_visits = ${selectedPoint.n_visits}` : undefined}
            />
            <KpiCard
              label="forecast 步数 / 步长"
              value={`${formatNumber(horizonSteps, 0)} 步`}
              hint={`平均步长 ${formatNumber(data.step_days, 1)} 天；末次观测 Day ${formatNumber(
                selectedPoint?.last_day ?? observed.at(-1)?.day,
                0,
              )}`}
            />
          </section>

          {cohort.length === 0 ? (
            <Alert>
              <AlertTitle>没有队列投影数据</AlertTitle>
              <AlertDescription>
                API 返回的 cohort 为空；请检查 latent 缓存与数据目录。
              </AlertDescription>
            </Alert>
          ) : (
            <div className="grid min-w-0 gap-4 xl:grid-cols-5">
              <div className="min-w-0 xl:col-span-3">
                <LatentScatter
                  cohort={cohort}
                  observed={observed}
                  forecast={forecast}
                  selectedId={activePatientId}
                  pca={pca}
                  onSelect={selectPatient}
                />
              </div>

              <aside
                aria-label="当前患者潜在空间详情"
                className="min-w-0 rounded-lg border border-outline-variant/50 bg-surface-lowest p-4 xl:col-span-2"
              >
                <p className="text-xs text-muted-foreground">当前患者</p>
                <h2 className="mt-0.5 truncate font-mono text-lg font-semibold">
                  {activePatientId}
                </h2>
                {selectedPoint ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    BCLC {selectedPoint.bclc_stage ?? "—"} · Child-Pugh{" "}
                    {selectedPoint.child_pugh ?? "—"} · {formatSex(selectedPoint.sex)} ·{" "}
                    {formatNumber(selectedPoint.age_at_index, 0)} 岁
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-muted-foreground">
                    该患者不在本次队列投影中（会话患者可能未被 PCA 覆盖）。
                  </p>
                )}

                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">随访次数</dt>
                    <dd className="mt-0.5 tabular-nums">
                      {selectedPoint?.n_visits ?? "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">末次 Day</dt>
                    <dd className="mt-0.5 tabular-nums">
                      {formatNumber(selectedPoint?.last_day, 0)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">observed 步数</dt>
                    <dd className="mt-0.5 tabular-nums">{observed.length}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">forecast 步数</dt>
                    <dd className="mt-0.5 tabular-nums">{forecast.length}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">平均步长</dt>
                    <dd className="mt-0.5 tabular-nums">{formatDays(data.step_days)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">数据来源</dt>
                    <dd className="mt-0.5">{data.data_source ?? "—"}</dd>
                  </div>
                </dl>

                <p className="mt-3 rounded-md bg-surface-low px-2.5 py-2 text-xs text-muted-foreground">
                  <span className="font-medium text-on-surface">PCA 说明：</span>
                  {pca?.note ?? "PCA 仅用于把 encoder latent 投到二维；坐标轴无临床含义。"}
                </p>
                <p className="mt-2 rounded-md bg-surface-low px-2.5 py-2 text-xs text-muted-foreground">
                  <span className="font-medium text-on-surface">forecast 说明：</span>
                  {data.note ??
                    "forecast 用末次治疗条件与平均步长做 latent rollout，仅展示模型内部状态走向，不代表疗效或临床轨迹。"}
                </p>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Link
                    href={`/world-model?patient=${encodeURIComponent(activePatientId)}`}
                    className={buttonVariants({ size: "sm" })}
                  >
                    去病程预测
                  </Link>
                  <Link
                    href="/patients"
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    去患者病程
                  </Link>
                </div>
              </aside>
            </div>
          )}

          <section
            aria-label="数据与边界"
            className="rounded-lg border border-outline-variant/50 bg-surface-lowest p-4"
          >
            <h2 className="text-sm font-medium">数据与边界</h2>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-xs text-muted-foreground">
              <li>
                数据来自 /api/v1/latent/&lt;patient_id&gt;：{data.data_source ?? "—"} ·{" "}
                {data.research_only === false ? "research_only 未标记" : "research_only"}；
                队列 1000 点为历史 latent 投影，forecast 为模型内部 rollout。
              </li>
              <li>
                PCA 坐标轴没有临床含义，不能当作生物标志物、分期依据或风险评分；
                点之间的远近不代表临床相似或治疗反应相似。
              </li>
              <li>
                点击队列点只切换当前患者并重新拉取该患者的 latent 路径（会同时返回队列缓存），
                不写入服务器、不改变模型。
              </li>
              <li>forecast 是末次治疗条件下的平均步长 rollout，不是个体疗效预测。</li>
            </ul>
          </section>
        </>
      ) : null}
    </div>
  );
}
