"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { fetchCohortSummary } from "@/lib/api";
import type { CohortSummaryResponse } from "@/lib/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import { CohortDistributions } from "@/components/cohort/CohortDistributions";
import { CohortScatter } from "@/components/cohort/CohortScatter";
import { CohortSelectionPanel } from "@/components/cohort/CohortSelectionPanel";
import {
  BCLC_STAGES,
  CHILD_PUGH_STAGES,
  DEFAULT_FILTERS,
  buildScatterData,
  countStages,
  filterPatients,
  findSimilarPatients,
  formatNumber,
  patientHasProgression,
  stageColor,
  toggleValue,
  treatmentEventCount,
  treatmentLabel,
  type CohortFilters,
} from "@/components/cohort/cohortUtils";

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function ToggleChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary",
        active
          ? "border-primary bg-primary-container/70 text-primary"
          : "border-outline-variant/60 bg-surface-lowest text-on-surface-variant hover:bg-surface-low",
      )}
    >
      {label}
    </button>
  );
}

function KpiCard({
  label,
  value,
  hint,
  children,
}: {
  label: string;
  value?: string;
  hint?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-outline-variant/50 bg-surface-lowest px-4 py-3">
      <p className="text-xs text-on-surface-variant">{label}</p>
      {value ? <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p> : null}
      {children}
      {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

/** /cohort 队列探索：客户端筛选 + 散点 + 详情 + kNN + 全队列分布。 */
export function CohortExplorer() {
  const [data, setData] = useState<CohortSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [filters, setFilters] = useState<CohortFilters>(DEFAULT_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    const token = requestRef.current + 1;
    requestRef.current = token;
    fetchCohortSummary()
      .then((summary) => {
        if (token !== requestRef.current) return;
        setData(summary);
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
      // 卸载或重新刷新时让旧请求结果失效。
      requestRef.current += 1;
    };
  }, [version]);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    setVersion((value) => value + 1);
  }, []);

  const patients = useMemo(() => data?.patients ?? [], [data]);
  const totalPatients = data?.n_patients ?? patients.length;

  const filtered = useMemo(() => filterPatients(patients, filters), [patients, filters]);
  const effectiveSelected = useMemo(
    () => filtered.find((patient) => patient.patient_id === selectedId) ?? filtered[0] ?? null,
    [filtered, selectedId],
  );
  const scatterData = useMemo(() => buildScatterData(filtered), [filtered]);
  const similar = useMemo(
    () =>
      effectiveSelected
        ? findSimilarPatients(filtered, effectiveSelected.patient_id, 3)
        : [],
    [filtered, effectiveSelected],
  );
  const filteredStages = useMemo(() => countStages(filtered), [filtered]);
  const filteredTreatmentEvents = useMemo(
    () => filtered.reduce((sum, patient) => sum + treatmentEventCount(patient), 0),
    [filtered],
  );
  const filteredProgression = useMemo(
    () => filtered.filter(patientHasProgression).length,
    [filtered],
  );

  const treatmentOptions = useMemo(
    () => Object.keys(data?.aggregate?.treatment_event_counts ?? {}).sort(),
    [data],
  );
  const stageCounts = data?.aggregate?.stage_counts ?? {};
  const childPughCounts = data?.aggregate?.child_pugh_counts ?? {};

  return (
    <div className="flex w-full flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-serif text-3xl font-semibold tracking-tight">
            Cohort · 队列探索
          </h1>
          <p className="mt-1.5 max-w-3xl text-sm text-muted-foreground">
            合成队列描述统计：结局 / 进展时间不是风险模型输出，不能当作个体风险或临床证据。
            队列 {formatNumber(totalPatients, 0)} 位患者 · {data?.data_source ?? "—"} ·
            research_only；筛选、相似病例均在浏览器内计算，不写入服务器。
          </p>
        </div>
        <Button variant="outline" onClick={refresh} disabled={loading}>
          {loading ? "刷新中…" : "刷新"}
        </Button>
      </header>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>队列数据读取失败</AlertTitle>
          <AlertDescription>
            {error}
            <span className="mt-1 block text-xs">
              确认本地 API 已启动（scripts/serve_api.py）且 /api/v1/cohort/summary 可访问。
            </span>
          </AlertDescription>
        </Alert>
      ) : null}
      {!data && loading ? (
        <p role="status" className="text-sm text-muted-foreground">
          正在读取队列摘要（约 1000 位患者）…
        </p>
      ) : null}
      {data?.available === false ? (
        <Alert>
          <AlertTitle>队列数据不可用</AlertTitle>
          <AlertDescription>
            {data.message ?? "API 未返回可用队列摘要；页面不会用占位数据代替。"}
          </AlertDescription>
        </Alert>
      ) : null}

      {data && data.available !== false ? (
        <>
          <section aria-label="筛选条件" className="rounded-lg border border-outline-variant/50 bg-surface-lowest p-4">
            <p className="mb-2 text-xs text-muted-foreground">
              分期 / Child-Pugh 标签上的数字为全队列计数；筛选后可多选，空选表示全部。
            </p>
            <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
              <div>
                <p className="text-xs text-muted-foreground">BCLC 分期（可多选，空 = 全部）</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {BCLC_STAGES.map((stage) => (
                    <ToggleChip
                      key={stage}
                      label={`BCLC ${stage}${stageCounts[stage] !== undefined ? ` · ${stageCounts[stage]}` : ""}`}
                      active={filters.stages.includes(stage)}
                      onClick={() =>
                        setFilters((current) => ({
                          ...current,
                          stages: toggleValue(current.stages, stage),
                        }))
                      }
                    />
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Child-Pugh（可多选，空 = 全部）</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {CHILD_PUGH_STAGES.map((stage) => (
                    <ToggleChip
                      key={stage}
                      label={`${stage}${childPughCounts[stage] !== undefined ? ` · ${childPughCounts[stage]}` : ""}`}
                      active={filters.childPughs.includes(stage)}
                      onClick={() =>
                        setFilters((current) => ({
                          ...current,
                          childPughs: toggleValue(current.childPughs, stage),
                        }))
                      }
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                治疗类别（任一记录）
                <NativeSelect
                  value={filters.treatment}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, treatment: event.target.value }))
                  }
                >
                  <NativeSelectOption value="all">全部治疗类别</NativeSelectOption>
                  {treatmentOptions.map((modality) => (
                    <NativeSelectOption key={modality} value={modality}>
                      {treatmentLabel(modality)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                患者 ID 搜索
                <Input
                  type="search"
                  placeholder="例如 SYN00364"
                  value={filters.query}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, query: event.target.value }))
                  }
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                年龄下限
                <Input
                  type="number"
                  min={0}
                  max={120}
                  value={filters.ageMin}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, ageMin: event.target.value }))
                  }
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                年龄上限
                <Input
                  type="number"
                  min={0}
                  max={120}
                  value={filters.ageMax}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, ageMax: event.target.value }))
                  }
                />
              </label>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p role="status" className="text-sm text-muted-foreground">
                当前筛选 <span className="font-medium text-on-surface">{filtered.length}</span> /{" "}
                {formatNumber(totalPatients, 0)} 位患者
                {loading ? "（刷新中…）" : ""}
              </p>
              <Button variant="outline" size="sm" onClick={() => setFilters(DEFAULT_FILTERS)}>
                重置筛选
              </Button>
            </div>
          </section>

          <section aria-label="队列 KPI" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="当前患者数"
              value={formatNumber(filtered.length, 0)}
              hint={`全队列 ${formatNumber(totalPatients, 0)} 位患者`}
            />
            <KpiCard label="BCLC 分布（筛选后）" hint="颜色仅区分分期；括号内为当前筛选计数">
              <div className="mt-1 flex flex-wrap gap-1.5">
                {filteredStages.length > 0 ? (
                  filteredStages.map((row) => (
                    <span
                      key={row.stage}
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
                      style={{
                        backgroundColor: `color-mix(in oklab, ${stageColor(row.stage)} 16%, transparent)`,
                        color: stageColor(row.stage),
                      }}
                    >
                      BCLC {row.stage} · {formatNumber(row.count, 0)}
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-muted-foreground">无患者</span>
                )}
              </div>
            </KpiCard>
            <KpiCard
              label="治疗事件数（筛选后）"
              value={formatNumber(filteredTreatmentEvents, 0)}
              hint="治疗记录总次数，不等于患者数；不能用于排序治疗优劣"
            />
            <KpiCard
              label="有 progression 记录（筛选后）"
              value={formatNumber(filteredProgression, 0)}
              hint={`全队列 aggregate.n_with_progression = ${formatNumber(data.aggregate?.n_with_progression, 0)}`}
            />
          </section>

          <div className="grid min-w-0 gap-4 xl:grid-cols-5">
            <div className="min-w-0 xl:col-span-3">
              <CohortScatter
                data={scatterData}
                selectedId={effectiveSelected?.patient_id ?? null}
                onSelect={setSelectedId}
              />
            </div>
            <div className="min-w-0 xl:col-span-2">
              <CohortSelectionPanel
                patient={effectiveSelected}
                similar={similar}
                onSelect={setSelectedId}
                scopeCount={filtered.length}
              />
            </div>
          </div>

          <CohortDistributions aggregate={data.aggregate} />

          <section
            aria-label="数据与边界"
            className="rounded-lg border border-outline-variant/50 bg-surface-lowest p-4"
          >
            <h2 className="text-sm font-medium">数据与边界</h2>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-xs text-muted-foreground">
              <li>
                数据来自 /api/v1/cohort/summary：{formatNumber(totalPatients, 0)} 位合成患者 ·{" "}
                {data.data_source ?? "—"} ·{" "}
                {data.research_only === false ? "research_only 未标记" : "research_only"}；
                筛选与相似病例均在浏览器内计算，不写入服务器。
              </li>
              <li>
                散点、分布与 KPI 都是描述统计，不是风险模型；progression 时间是已记录结局，
                不是个体风险预测，也不能当临床证据。
              </li>
              <li>
                相似病例只按基线特征做 z-score 距离辅助选例，不代表相似疗效、预后或治疗推荐；
                治疗事件计数不能用于排序治疗。
              </li>
              {data.note ? <li>{data.note}</li> : null}
            </ul>
          </section>
        </>
      ) : null}
    </div>
  );
}
