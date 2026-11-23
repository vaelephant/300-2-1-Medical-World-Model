"use client";

import Link from "next/link";

import type { EvaluationReportsResponse, ModelMeta } from "@/lib/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BeatBadge, Panel, StatusBadge } from "@/components/overview/primitives";
import {
  baseName,
  formatDateTime,
  formatMetric,
  samePath,
} from "@/components/overview/types";

type Consistency = {
  tone: "ok" | "bad" | "neutral";
  label: string;
};

/** 把报告里的 model_version / checkpoint 与页面模型卡对比，区分正式结果与测试产物。 */
function reportConsistency(
  report: EvaluationReportsResponse["reports"][number],
  meta: ModelMeta | null,
): Consistency {
  const version = report.model_version;
  const checkpoint = report.checkpoint;
  const metaVersion = meta?.model_version;
  const metaCheckpoint = meta?.checkpoint;
  if (!version && !checkpoint) return { tone: "neutral", label: "版本未提供" };
  const versionMatch = version && metaVersion ? version === metaVersion : null;
  const checkpointMatch =
    checkpoint && metaCheckpoint ? samePath(checkpoint, metaCheckpoint) : null;
  if (versionMatch === false || checkpointMatch === false) {
    return { tone: "bad", label: "与当前权重/版本不一致" };
  }
  if (versionMatch === true || checkpointMatch === true) {
    return { tone: "ok", label: "与当前模型卡一致" };
  }
  return { tone: "neutral", label: "无法对比当前权重" };
}

function looksTemporary(path?: string | null): boolean {
  if (!path) return false;
  return /(pytest|var\/folders|\/tmp\/|\/T\/|temp)/i.test(path);
}

/** 报告列表：reports/*.json 的摘要与 provenance；完整报告在 /evaluation。 */
export function ReportsTable({
  reports,
  reportsError,
  loading,
  meta,
  defaultReportFile,
}: {
  reports: EvaluationReportsResponse | null;
  reportsError: string | null;
  loading: boolean;
  meta: ModelMeta | null;
  defaultReportFile?: string;
}) {
  const description =
    "reports/*.json 摘要（按修改时间倒序）；完整指标与图表见 /evaluation。";

  if (reportsError) {
    return (
      <Panel title="评估报告列表" description={description}>
        <Alert variant="destructive">
          <AlertTitle>报告列表读取失败</AlertTitle>
          <AlertDescription>{reportsError}</AlertDescription>
        </Alert>
      </Panel>
    );
  }

  if (!reports) {
    return (
      <Panel title="评估报告列表" description={description}>
        <p role="status" className="text-sm text-muted-foreground">
          {loading ? "正在读取 reports/ 目录…" : "暂无评估报告列表。"}
        </p>
      </Panel>
    );
  }

  const items = reports.reports ?? [];

  return (
    <Panel
      title="评估报告列表"
      description={description}
      actions={
        <Link href="/evaluation" className={buttonVariants({ variant: "outline", size: "sm" })}>
          打开 /evaluation
        </Link>
      }
    >
      {items.length === 0 ? (
        <Alert>
          <AlertTitle>报告目录为空</AlertTitle>
          <AlertDescription>
            reports/ 目录下未发现 .json 评估报告：{reports.reports_dir ?? "—"}
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <Table>
            <TableCaption>
              默认报告由服务端 MWM_EVAL_REPORT 指定（通常 eval_mvp.json），/evaluation
              展示的就是它。本表按 model_version / checkpoint 与上方模型卡对比：
              版本或权重不一致、或 checkpoint 指向 pytest 临时路径的报告，属于测试 /
              旧产物，不要当作正式结果。修改时间按浏览器本地时区显示。
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[34%]">报告文件</TableHead>
                <TableHead>模型版本</TableHead>
                <TableHead>split</TableHead>
                <TableHead>患者数</TableHead>
                <TableHead>vs Persistence</TableHead>
                <TableHead>修改时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item, index) => {
                const consistency = reportConsistency(item, meta);
                const fileName = baseName(item.report?.path);
                const temporary = looksTemporary(item.checkpoint);
                const isDefaultReport = samePath(item.report?.path, defaultReportFile);
                return (
                  <TableRow key={`${fileName}-${index}`}>
                    <TableCell className="max-w-[340px] align-top">
                      <Link
                        href="/evaluation"
                        className="font-medium text-primary underline-offset-4 hover:underline"
                        title={item.report?.path ?? undefined}
                      >
                        {fileName}
                      </Link>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {isDefaultReport ? (
                          <StatusBadge tone="ok" label="默认报告 · /evaluation 展示" />
                        ) : null}
                        <StatusBadge tone={consistency.tone} label={consistency.label} />
                        {temporary ? (
                          <span className="rounded-sm bg-warning-surface px-1.5 py-0.5 text-[10px] text-warning">
                            测试临时 checkpoint 路径
                          </span>
                        ) : null}
                      </div>
                      {item.available === false ? (
                        <p className="mt-1 text-xs text-error">
                          {item.reason ?? "报告不可用"}
                        </p>
                      ) : null}
                      {item.checkpoint ? (
                        <p
                          className="mt-1 max-w-[320px] truncate font-mono text-[10px] text-muted-foreground"
                          title={item.checkpoint}
                        >
                          {item.checkpoint}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell className="max-w-[180px] truncate align-top" title={item.model_version ?? undefined}>
                      {item.model_version ?? "—"}
                    </TableCell>
                    <TableCell className="align-top">{item.split ?? "—"}</TableCell>
                    <TableCell className="align-top tabular-nums">
                      {formatMetric(item.n_patients, 0)}
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="flex flex-wrap gap-1">
                        <BeatBadge label="含 AFP" beats={item.beats_persistence_mae} />
                        <BeatBadge label="宏平均" beats={item.beats_persistence_mae_macro} />
                        <BeatBadge label="排除 AFP" beats={item.beats_persistence_mae_ex_afp} />
                      </div>
                    </TableCell>
                    <TableCell className="align-top text-muted-foreground">
                      {formatDateTime(item.report?.modified_at)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <p className="mt-3 text-xs text-muted-foreground">
            报告目录：{reports.reports_dir ?? "—"}；数据来自
            /api/v1/evaluations/reports。点击文件名进入 /evaluation（默认报告）查看完整表格与图表。
          </p>
        </>
      )}
    </Panel>
  );
}
