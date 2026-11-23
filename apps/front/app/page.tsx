"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  fetchEvaluations,
  fetchHealth,
  fetchModelMeta,
  getApiBase,
} from "@/lib/api";
import type { ModelMeta } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { OverviewDashboard } from "@/components/overview/OverviewDashboard";
import type { FullEvalReport, HealthResponse } from "@/components/overview/types";

type Settled<T> = { data: T | null; error: string | null };

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function OverviewPage() {
  const [meta, setMeta] = useState<ModelMeta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [report, setReport] = useState<FullEvalReport | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const requestRef = useRef(0);

  useEffect(() => {
    const token = requestRef.current + 1;
    requestRef.current = token;

    // 三路并行读取；meta / health / report 各自 catch 降级，互不阻塞。
    const metaPromise: Promise<Settled<ModelMeta>> = fetchModelMeta()
      .then((data) => ({ data, error: null }))
      .catch((error) => ({ data: null, error: toMessage(error) }));
    const healthPromise: Promise<Settled<HealthResponse>> = fetchHealth()
      .then((data) => ({ data, error: null }))
      .catch((error) => ({ data: null, error: toMessage(error) }));
    const reportPromise: Promise<Settled<FullEvalReport>> = fetchEvaluations()
      .then((data) => ({ data: data as unknown as FullEvalReport, error: null }))
      .catch((error) => ({ data: null, error: toMessage(error) }));

    Promise.all([metaPromise, healthPromise, reportPromise]).then(
      ([metaResult, healthResult, reportResult]) => {
        if (token !== requestRef.current) return;
        setMeta(metaResult.data);
        setMetaError(metaResult.error);
        setHealth(healthResult.data);
        setHealthError(healthResult.error);
        setReport(reportResult.data);
        setReportError(reportResult.error);
        setLoading(false);
      },
    );

    return () => {
      // 卸载或重新刷新时让旧请求结果失效。
      requestRef.current += 1;
    };
  }, [version]);

  const refresh = useCallback(() => {
    setLoading(true);
    setMetaError(null);
    setHealthError(null);
    setReportError(null);
    setVersion((value) => value + 1);
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl font-semibold tracking-tight">
            Overview · 总览
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            研究原型状态页：模型卡、推理服务、评估快照与演示入口。所有数值均来自本地推理
            服务 API，不在前端硬编码；缺失数据会显示为 — 或可操作提示。
          </p>
        </div>
        <div className="flex items-center gap-3">
          {loading ? (
            <span role="status" className="text-xs text-muted-foreground">
              正在刷新状态…
            </span>
          ) : null}
          <Button variant="outline" onClick={refresh} disabled={loading}>
            {loading ? "刷新中…" : "刷新状态"}
          </Button>
        </div>
      </header>

      <OverviewDashboard
        meta={meta}
        metaError={metaError}
        health={health}
        healthError={healthError}
        report={report}
        reportError={reportError}
        loading={loading}
        apiBase={getApiBase()}
      />
    </div>
  );
}
