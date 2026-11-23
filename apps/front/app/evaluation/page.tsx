"use client";

import { useEffect, useState } from "react";

import { fetchEvaluations, fetchModelMeta } from "@/lib/api";
import type { ModelMeta } from "@/lib/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EvaluationDashboard } from "@/components/evaluation/EvaluationDashboard";
import type { FullEvalReport } from "@/components/evaluation/types";

export default function EvaluationPage() {
  const [report, setReport] = useState<FullEvalReport | null>(null);
  const [meta, setMeta] = useState<ModelMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    // 模型卡数据失败不能阻塞评估报告：meta 单独降级为 null。
    Promise.all([fetchEvaluations(), fetchModelMeta().catch(() => null)])
      .then(([data, modelMeta]) => {
        if (!active) return;
        setReport(data as unknown as FullEvalReport);
        setMeta(modelMeta);
      })
      .catch((err) => {
        if (active) setError(String(err));
      });
    return () => {
      active = false;
    };
  }, [version]);

  function refresh() {
    setError(null);
    setReport(null);
    setMeta(null);
    setVersion((value) => value + 1);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-semibold">Evaluation · 模型评估</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            真实训练产物评估 · 测试集误差越低越好；指标与 provenance
            均读取本地推理服务，不在前端硬编码。
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
        <EvaluationDashboard report={report} meta={meta} />
      ) : null}
    </div>
  );
}
