"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  fetchEvaluationReport,
  fetchEvaluationReports,
  fetchEvaluations,
  fetchModelCheckpoints,
  fetchModelMeta,
} from "@/lib/api";
import type {
  CheckpointsResponse,
  EvaluationReportsResponse,
  ModelMeta,
} from "@/lib/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EvaluationDashboard } from "@/components/evaluation/EvaluationDashboard";
import { ReportComparison } from "@/components/evaluation/ReportComparison";
import { baseName, type FullEvalReport } from "@/components/evaluation/types";

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function EvaluationPage() {
  const [report, setReport] = useState<FullEvalReport | null>(null);
  const [meta, setMeta] = useState<ModelMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const [reports, setReports] = useState<EvaluationReportsResponse | null>(null);
  const [reportsError, setReportsError] = useState<string | null>(null);
  const [checkpoints, setCheckpoints] = useState<CheckpointsResponse | null>(null);

  const [selectionA, setSelectionA] = useState<string | null>(null);
  const [selectionB, setSelectionB] = useState<string | null>(null);
  const [comparison, setComparison] = useState<{
    fileA: string;
    fileB: string;
    reportA: FullEvalReport;
    reportB: FullEvalReport;
  } | null>(null);
  const [comparisonError, setComparisonError] = useState<string | null>(null);
  const comparisonRef = useRef(0);

  useEffect(() => {
    let active = true;
    // 默认报告 / 模型卡 / 报告列表 / checkpoint 列表：各自降级，互不阻塞。
    Promise.all([
      fetchEvaluations()
        .then((data) => ({ data, error: null as string | null }))
        .catch((cause) => ({ data: null, error: toMessage(cause) })),
      fetchModelMeta()
        .then((data) => ({ data, error: null as string | null }))
        .catch((cause) => ({ data: null, error: toMessage(cause) })),
      fetchEvaluationReports()
        .then((data) => ({ data, error: null as string | null }))
        .catch((cause) => ({ data: null, error: toMessage(cause) })),
      fetchModelCheckpoints()
        .then((data) => ({ data, error: null as string | null }))
        .catch((cause) => ({ data: null, error: toMessage(cause) })),
    ]).then(([reportResult, metaResult, reportsResult, checkpointsResult]) => {
      if (!active) return;
      setReport(reportResult.data as unknown as FullEvalReport | null);
      setError(reportResult.error);
      setMeta(metaResult.data);
      setReports(reportsResult.data);
      setReportsError(reportsResult.error);
      setCheckpoints(checkpointsResult.data);
    });
    return () => {
      active = false;
    };
  }, [version]);

  const reportOptions = useMemo(() => {
    const names = (reports?.reports ?? [])
      .filter((item) => item.available !== false)
      .map((item) => baseName(item.report?.path))
      .filter((name) => name !== "—");
    return Array.from(new Set(names));
  }, [reports]);

  const defaultReportName = useMemo(() => {
    const fromReport = report?.report_file ? baseName(report.report_file) : null;
    return fromReport ?? reportOptions[0] ?? null;
  }, [report, reportOptions]);

  const fileA = selectionA ?? defaultReportName ?? reportOptions[0] ?? null;
  const fileB = useMemo(() => {
    if (selectionB) return selectionB;
    return reportOptions.find((name) => name !== fileA) ?? null;
  }, [selectionB, reportOptions, fileA]);

  useEffect(() => {
    if (!fileA || !fileB || fileA === fileB) return;
    const token = comparisonRef.current + 1;
    comparisonRef.current = token;
    Promise.all([fetchEvaluationReport(fileA), fetchEvaluationReport(fileB)])
      .then(([dataA, dataB]) => {
        if (token !== comparisonRef.current) return;
        setComparison({
          fileA,
          fileB,
          reportA: dataA as unknown as FullEvalReport,
          reportB: dataB as unknown as FullEvalReport,
        });
        setComparisonError(null);
      })
      .catch((cause) => {
        if (token !== comparisonRef.current) return;
        setComparisonError(toMessage(cause));
      });
    return () => {
      comparisonRef.current += 1;
    };
  }, [fileA, fileB, version]);

  const comparisonMatches =
    Boolean(comparison && fileA && fileB) &&
    comparison?.fileA === fileA &&
    comparison?.fileB === fileB;
  const comparisonPending = Boolean(
    fileA && fileB && fileA !== fileB && !comparisonError && !comparisonMatches,
  );

  function selectA(name: string) {
    setSelectionA(name);
    setComparisonError(null);
    if (name === fileB && fileA) setSelectionB(fileA);
  }

  function selectB(name: string) {
    setSelectionB(name);
    setComparisonError(null);
    if (name === fileA) setSelectionA(fileB ?? name);
  }

  function refresh() {
    setError(null);
    setReport(null);
    setMeta(null);
    setReports(null);
    setReportsError(null);
    setCheckpoints(null);
    setComparison(null);
    setComparisonError(null);
    setVersion((value) => value + 1);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-semibold">Evaluation · 模型评估</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            真实训练产物评估 · 测试集误差越低越好；指标与 provenance
            均读取本地推理服务，不在前端硬编码。支持多报告 A/B 对比。
          </p>
        </div>
        <Button variant="outline" onClick={refresh}>
          刷新报告
        </Button>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>读取失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {!report && !error ? (
        <p role="status" className="text-sm text-muted-foreground">
          正在加载评估报告…
        </p>
      ) : null}
      {report?.available === false ? (
        <Alert>
          <AlertTitle>暂无评估报告</AlertTitle>
          <AlertDescription>
            {report.message ?? "推理服务未返回可用评估报告（reports/*.json）。"}
          </AlertDescription>
        </Alert>
      ) : null}

      {report && report.available !== false ? (
        <>
          <ReportComparison
            reports={reports}
            reportsError={reportsError}
            reportA={comparisonMatches ? comparison?.reportA ?? null : null}
            reportB={comparisonMatches ? comparison?.reportB ?? null : null}
            fileA={fileA}
            fileB={fileB}
            loading={comparisonPending}
            error={comparisonError}
            currentCheckpoint={checkpoints?.current_checkpoint}
            onSelectA={selectA}
            onSelectB={selectB}
          />
          <EvaluationDashboard report={report} meta={meta} />
        </>
      ) : null}
    </div>
  );
}
