"use client";
import { useEffect, useState } from "react";
import { fetchEvaluations } from "@/lib/api";
import type { EvalReport } from "@/lib/types";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell, TableCaption } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
const fmt = (value?: number) => value == null || !Number.isFinite(value) ? "未提供" : value.toLocaleString("zh-CN", { maximumFractionDigits: 4 });
export default function EvaluationPage() {
  const [report, setReport] = useState<EvalReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    fetchEvaluations().then(data => { if (active) setReport(data); }).catch(e => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, [version]);
  return <div className="flex flex-col gap-6">
    <div className="flex items-center justify-between gap-4"><div><h1 className="font-serif text-3xl font-semibold">Evaluation · 模型评估</h1><p className="mt-2 text-sm text-muted-foreground">已有评估报告 · 合成测试集 · 误差越低越好</p></div><Button variant="outline" onClick={() => { setError(null); setReport(null); setVersion(v => v + 1); }}>刷新报告</Button></div>
    {error && <Alert variant="destructive"><AlertTitle>读取失败</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
    {!report && !error && <p role="status">正在加载评估报告…</p>}
    {report?.available === false && <Alert><AlertTitle>暂无评估报告</AlertTitle><AlertDescription>{report.message}</AlertDescription></Alert>}
    {report && report.available !== false && <>
      <p className="text-sm text-muted-foreground">{report.model_version ?? "版本未提供"} · {report.n_patients ?? "未知"} 位患者 · {report.split ?? "切分未提供"} · {report.data_source ?? "来源未提供"}</p>
      <Alert><AlertTitle>指标解释</AlertTitle><AlertDescription>各特征单位不同，汇总 MAE 只能作为工程诊断，不能视作统一临床评分。AFP 数值尺度大；请同时检查逐特征误差、含 AFP 与排除 AFP 的结果。</AlertDescription></Alert>
      <Table><TableCaption>Persistence：保持末次观测值的基线。负差值表示模型误差较小。</TableCaption><TableHeader><TableRow><TableHead>汇总指标</TableHead><TableHead>世界模型</TableHead><TableHead>Persistence</TableHead><TableHead>模型 − 基线</TableHead></TableRow></TableHeader><TableBody>
        {([['mae_mean', '总体 MAE（含 AFP）'], ['mae_macro', '特征 MAE 均值（未标准化）'], ['mae_ex_afp', 'MAE（排除 AFP）']] as const).map(([key, label]) => {
          const model = report.world_model?.[key], base = report.persistence?.[key];
          return <TableRow key={key}><TableCell>{label}</TableCell><TableCell>{fmt(model)}</TableCell><TableCell>{fmt(base)}</TableCell><TableCell>{fmt(model == null || base == null ? undefined : model - base)}</TableCell></TableRow>;
        })}
      </TableBody></Table>
      <h2 className="text-lg font-semibold">逐特征误差</h2>
      <Table><TableHeader><TableRow><TableHead>特征</TableHead><TableHead>模型 MAE</TableHead><TableHead>基线 MAE</TableHead><TableHead>模型 RMSE</TableHead></TableRow></TableHeader><TableBody>
        {Object.entries(report.world_model?.mae_per_feature ?? {}).map(([key, value]) => <TableRow key={key}><TableCell>{key}</TableCell><TableCell>{fmt(value)}</TableCell><TableCell>{fmt(report.persistence?.mae_per_feature?.[key])}</TableCell><TableCell>{fmt(report.world_model?.rmse_per_feature?.[key])}</TableCell></TableRow>)}
      </TableBody></Table>
      <h2 className="text-lg font-semibold">多步 Rollout · 上下文 {report.rollout?.context_len ?? "未知"} 次随访</h2>
      <Table><TableCaption>现有报告中的多步误差；未提供的指标不会按零展示。</TableCaption><TableHeader><TableRow><TableHead>预测步数</TableHead><TableHead>MAE（含 AFP）</TableHead><TableHead>AFP MAE</TableHead><TableHead>肿瘤直径 MAE</TableHead></TableRow></TableHeader><TableBody>
        {Object.entries(report.rollout?.horizons ?? {}).map(([step, m]) => <TableRow key={step}><TableCell>{step}</TableCell><TableCell>{fmt(m.mae_mean)}</TableCell><TableCell>{fmt(m.mae_per_feature?.afp)}</TableCell><TableCell>{fmt(m.mae_per_feature?.tumor_size_cm)}</TableCell></TableRow>)}
      </TableBody></Table>
    </>}
  </div>;
}
