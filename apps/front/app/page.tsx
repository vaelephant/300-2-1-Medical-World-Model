"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  fetchEvaluationReports,
  fetchEvaluations,
  fetchHealth,
  fetchModelCheckpoints,
  fetchModelMeta,
  fetchTraining,
  getApiBase,
} from "@/lib/api";
import type {
  CheckpointsResponse,
  EvaluationReportsResponse,
  ModelMeta,
  TrainingInfo,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { OverviewDashboard } from "@/components/overview/OverviewDashboard";
import type { FullEvalReport, HealthResponse } from "@/components/overview/types";

type Settled<T> = { data: T | null; error: string | null };

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  return promise
    .then((data) => ({ data, error: null }))
    .catch((error) => ({ data: null, error: toMessage(error) }));
}

export default function OverviewPage() {
  const [meta, setMeta] = useState<ModelMeta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [report, setReport] = useState<FullEvalReport | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [training, setTraining] = useState<TrainingInfo | null>(null);
  const [trainingError, setTrainingError] = useState<string | null>(null);
  const [checkpoints, setCheckpoints] = useState<CheckpointsResponse | null>(null);
  const [checkpointsError, setCheckpointsError] = useState<string | null>(null);
  const [reports, setReports] = useState<EvaluationReportsResponse | null>(null);
  const [reportsError, setReportsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const requestRef = useRef(0);

  useEffect(() => {
    const token = requestRef.current + 1;
    requestRef.current = token;

    // 六路并行读取；每一路各自 catch 降级，互不阻塞。
    // 注意：训练/报告/checkpoint 来自真实产物（train_meta.json / train_meta.json 同目录、
    // artifacts/models 与 reports/），没有数据时由后端返回 available=false 或空数组。
    Promise.all([
      settle(fetchModelMeta()),
      settle(fetchHealth()),
      settle(fetchEvaluations()),
      settle(fetchTraining()),
      settle(fetchModelCheckpoints()),
      settle(fetchEvaluationReports()),
    ]).then(
      ([
        metaResult,
        healthResult,
        reportResult,
        trainingResult,
        checkpointsResult,
        reportsResult,
      ]) => {
        if (token !== requestRef.current) return;
        setMeta(metaResult.data);
        setMetaError(metaResult.error);
        setHealth(healthResult.data);
        setHealthError(healthResult.error);
        setReport(reportResult.data as unknown as FullEvalReport | null);
        setReportError(reportResult.error);
        setTraining(trainingResult.data);
        setTrainingError(trainingResult.error);
        setCheckpoints(checkpointsResult.data);
        setCheckpointsError(checkpointsResult.error);
        setReports(reportsResult.data);
        setReportsError(reportsResult.error);
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
    setTrainingError(null);
    setCheckpointsError(null);
    setReportsError(null);
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
            研究原型状态页：模型卡、训练曲线、checkpoint 与评估报告列表、推理服务状态。
            所有数值均来自本地推理服务 API 与磁盘产物，不在前端硬编码；缺失数据会显示为 —
            或可操作提示。
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
        training={training}
        trainingError={trainingError}
        checkpoints={checkpoints}
        checkpointsError={checkpointsError}
        reports={reports}
        reportsError={reportsError}
        loading={loading}
        apiBase={getApiBase()}
      />
    </div>
  );
}
