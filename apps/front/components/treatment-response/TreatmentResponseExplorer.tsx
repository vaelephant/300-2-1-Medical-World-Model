"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { fetchTreatmentResponse } from "@/lib/api";
import type { TreatmentResponseResponse } from "@/lib/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { TreatmentResponseHeatmap } from "@/components/treatment-response/TreatmentResponseHeatmap";
import { TreatmentResponseTable } from "@/components/treatment-response/TreatmentResponseTable";
import {
  formatNumber,
  modalityLabel,
  sortedModalities,
} from "@/components/treatment-response/treatmentResponseUtils";

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

/** /treatment-response 治疗响应矩阵：治疗事件前后相邻随访的描述性变化。 */
export function TreatmentResponseExplorer() {
  const [data, setData] = useState<TreatmentResponseResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const requestRef = useRef(0);

  useEffect(() => {
    const token = requestRef.current + 1;
    requestRef.current = token;
    fetchTreatmentResponse()
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
      requestRef.current += 1;
    };
  }, [version]);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    setVersion((value) => value + 1);
  }, []);

  const modalities = useMemo(() => sortedModalities(data?.modalities), [data]);
  const modalityCount = modalities.length;
  const topModality = modalities[0] ?? null;
  const features = data?.features ?? [];

  return (
    <div className="flex w-full flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-serif text-3xl font-semibold tracking-tight">
            Treatment Response · 治疗响应
          </h1>
          <p className="mt-1.5 max-w-3xl text-sm text-muted-foreground">
            合成队列中，治疗事件前后相邻随访的描述性变化。治疗不是随机分配的，
            这些前后差异不能解释为因果疗效，也不能用于排序治疗优劣；多数治疗类别的
            肿瘤直径 median Δ 为 0（合成轨迹），不能据此说治疗无效或有效。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/simulation" className={buttonVariants({ variant: "outline", size: "sm" })}>
            去治疗情景
          </Link>
          <Link href="/cohort" className={buttonVariants({ variant: "outline", size: "sm" })}>
            去队列探索
          </Link>
          <Button variant="outline" onClick={refresh} disabled={loading}>
            {loading ? "刷新中…" : "刷新"}
          </Button>
        </div>
      </header>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>治疗响应数据读取失败</AlertTitle>
          <AlertDescription>
            {error}
            <span className="mt-1 block text-xs">
              确认本地 API 已启动（scripts/serve_api.py），且
              /api/v1/treatment-response 可访问。
            </span>
          </AlertDescription>
        </Alert>
      ) : null}
      {!data && loading ? (
        <p role="status" className="text-sm text-muted-foreground">
          正在读取治疗响应矩阵…
        </p>
      ) : null}
      {data?.available === false ? (
        <Alert>
          <AlertTitle>治疗响应数据不可用</AlertTitle>
          <AlertDescription>
            {data.message ?? "API 未返回可用 treatment-response 数据；页面不会用占位数据代替。"}
          </AlertDescription>
        </Alert>
      ) : null}

      {data && data.available !== false ? (
        <>
          <section aria-label="治疗响应 KPI" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="队列患者数"
              value={formatNumber(data.n_patients, 0)}
              hint={`数据来源 ${data.data_source ?? "—"} · research_only`}
            />
            <KpiCard
              label="治疗事件数"
              value={formatNumber(data.n_events, 0)}
              hint="事件前后各取相邻随访配对计算，缺失特征跳过"
            />
            <KpiCard
              label="治疗类别数"
              value={formatNumber(modalityCount, 0)}
              hint={`矩阵按 n_events 降序；${features.length} 个特征`}
            />
            <KpiCard
              label="最大样本类别"
              value={topModality ? modalityLabel(topModality.key) : "—"}
              hint={
                topModality
                  ? `${formatNumber(topModality.data.n_events, 0)} events · ${formatNumber(
                      topModality.data.n_patients,
                      0,
                    )} 位患者`
                  : undefined
              }
            />
          </section>

          {modalities.length === 0 ? (
            <Alert>
              <AlertTitle>没有可展示的治疗类别</AlertTitle>
              <AlertDescription>API 返回的 modalities 为空。</AlertDescription>
            </Alert>
          ) : (
            <>
              <TreatmentResponseHeatmap response={data} />
              <TreatmentResponseTable response={data} />
            </>
          )}

          <section
            aria-label="数据与边界"
            className="rounded-lg border border-outline-variant/50 bg-surface-lowest p-4"
          >
            <h2 className="text-sm font-medium">数据与边界</h2>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-xs text-muted-foreground">
              <li>
                数据来自 /api/v1/treatment-response：{formatNumber(data.n_events, 0)} 个治疗事件 ·{" "}
                {formatNumber(data.n_patients, 0)} 位患者 · {data.data_source ?? "—"} ·{" "}
                {data.research_only === false ? "research_only 未标记" : "research_only"}。
              </li>
              <li>
                治疗非随机分配：治疗组与未治疗组的患者特征可能系统不同，前后变化不能解释为
                因果疗效；本页不做匹配、不做推断统计、不排序治疗。
              </li>
              <li>
                median_pct / IQR 是描述性统计；多数治疗类别的肿瘤直径 median Δ 为 0，
                不能据此判断治疗无效或有效。
              </li>
              <li>{data.note ?? "按治疗事件前后相邻随访计算描述性变化；不可解释为因果疗效。"}</li>
            </ul>
          </section>
        </>
      ) : null}
    </div>
  );
}
