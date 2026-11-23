"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { EvaluationReportsResponse } from "@/lib/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  baseName,
  buildFeatureComparisonRows,
  buildRolloutComparisonRows,
  formatMetric,
  formatSigned,
  looksTemporaryCheckpoint,
  samePath,
  type FullEvalReport,
} from "@/components/evaluation/types";

const TOOLTIP_STYLE = {
  background: "var(--popover)",
  color: "var(--popover-foreground)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 12,
} as const;

const COLOR_A = "var(--chart-observed)";
const COLOR_B = "var(--chart-forecast)";

function metricDelta(a?: number | null, b?: number | null): number | null {
  if (
    a === undefined ||
    a === null ||
    b === undefined ||
    b === null ||
    !Number.isFinite(a) ||
    !Number.isFinite(b)
  ) {
    return null;
  }
  return b - a;
}

function ReportMeta({
  label,
  file,
  report,
  currentCheckpoint,
}: {
  label: string;
  file: string | null;
  report: FullEvalReport | null;
  currentCheckpoint?: string | null;
}) {
  const checkpoint = report?.checkpoint;
  const temporary = looksTemporaryCheckpoint(checkpoint);
  const matchesCurrent = Boolean(
    checkpoint && currentCheckpoint && samePath(checkpoint, currentCheckpoint),
  );
  return (
    <div className="min-w-0 rounded-md border border-outline-variant/50 bg-surface-low px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate font-mono text-xs font-medium" title={file ?? undefined}>
        {file ?? "—"}
      </p>
      <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        <div className="col-span-2 flex min-w-0 gap-1">
          <dt className="shrink-0">版本</dt>
          <dd className="truncate">{report?.model_version ?? "—"}</dd>
        </div>
        <div className="col-span-2 flex min-w-0 gap-1">
          <dt className="shrink-0">checkpoint</dt>
          <dd className="truncate font-mono" title={checkpoint ?? undefined}>
            {checkpoint ?? "—"}
          </dd>
        </div>
        <div className="flex gap-1">
          <dt>split</dt>
          <dd>{report?.split ?? "—"}</dd>
        </div>
        <div className="flex gap-1">
          <dt>患者数</dt>
          <dd className="tabular-nums">{formatMetric(report?.n_patients, 0)}</dd>
        </div>
      </dl>
      <div className="mt-1 flex flex-wrap gap-1">
        {temporary ? (
          <span className="rounded-sm bg-warning-surface px-1.5 py-0.5 text-[10px] text-warning">
            测试临时 checkpoint 路径
          </span>
        ) : null}
        {currentCheckpoint ? (
          <span
            className={
              matchesCurrent
                ? "rounded-sm bg-tertiary-container/60 px-1.5 py-0.5 text-[10px] text-tertiary"
                : "rounded-sm bg-surface-lowest px-1.5 py-0.5 text-[10px] text-muted-foreground"
            }
          >
            {matchesCurrent ? "与当前服务权重一致" : "≠ 当前服务权重"}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** 多报告对比：A/B 选择、汇总 B−A、逐特征 MAE 分组条图、多步 rollout 折线。 */
export function ReportComparison({
  reports,
  reportsError,
  reportA,
  reportB,
  fileA,
  fileB,
  loading,
  error,
  currentCheckpoint,
  onSelectA,
  onSelectB,
}: {
  reports: EvaluationReportsResponse | null;
  reportsError: string | null;
  reportA: FullEvalReport | null;
  reportB: FullEvalReport | null;
  fileA: string | null;
  fileB: string | null;
  loading: boolean;
  error: string | null;
  currentCheckpoint?: string | null;
  onSelectA: (name: string) => void;
  onSelectB: (name: string) => void;
}) {
  const summaryItems = (reports?.reports ?? []).filter((item) => item.available !== false);
  const optionNames = summaryItems
    .map((item) => baseName(item.report?.path))
    .filter((name) => name !== "—");
  const uniqueOptions = Array.from(new Set(optionNames));
  const reportsLoaded = reports !== null;
  const hasTwo = uniqueOptions.length >= 2;
  const onlyOne = reportsLoaded && !hasTwo;

  const temporaryReports = [fileA, fileB].filter((file, index) =>
    looksTemporaryCheckpoint(index === 0 ? reportA?.checkpoint : reportB?.checkpoint),
  );

  const comparabilityWarnings: string[] = [];
  if (reportA && reportB) {
    if ((reportA.split ?? null) !== (reportB.split ?? null)) {
      comparabilityWarnings.push(
        `split 不同：${reportA.split ?? "—"} vs ${reportB.split ?? "—"}`,
      );
    }
    if ((reportA.n_patients ?? null) !== (reportB.n_patients ?? null)) {
      comparabilityWarnings.push(
        `测试患者数不同：${formatMetric(reportA.n_patients, 0)} vs ${formatMetric(reportB.n_patients, 0)}`,
      );
    }
    if ((reportA.model_version ?? null) !== (reportB.model_version ?? null)) {
      comparabilityWarnings.push(
        `模型版本不同：${reportA.model_version ?? "—"} vs ${reportB.model_version ?? "—"}`,
      );
    }
    if (
      reportA.checkpoint &&
      reportB.checkpoint &&
      !samePath(reportA.checkpoint, reportB.checkpoint)
    ) {
      comparabilityWarnings.push("checkpoint 不同（两份报告来自不同权重）");
    }
    if (
      (reportA.rollout?.context_len ?? null) !== (reportB.rollout?.context_len ?? null)
    ) {
      comparabilityWarnings.push(
        `rollout 上下文长度不同：${reportA.rollout?.context_len ?? "—"} vs ${reportB.rollout?.context_len ?? "—"}`,
      );
    }
  }

  const featureRows =
    reportA && reportB ? buildFeatureComparisonRows(reportA, reportB) : [];
  const rolloutRows =
    reportA && reportB ? buildRolloutComparisonRows(reportA, reportB) : [];
  const horizonsA = reportA?.rollout?.horizons ?? {};
  const horizonsB = reportB?.rollout?.horizons ?? {};
  const hasRollout =
    Object.keys(horizonsA).length > 0 && Object.keys(horizonsB).length > 0;

  const summaryRows = [
    ["mae_mean", "总体 MAE（含 AFP）"],
    ["mae_macro", "特征 MAE 均值（未标准化）"],
    ["mae_ex_afp", "MAE（排除 AFP）"],
  ] as const;

  return (
    <section
      aria-label="多报告对比"
      className="rounded-lg border border-outline-variant/50 bg-surface-lowest p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">报告对比</h2>
        <p className="text-xs text-muted-foreground">
          选择两份评估报告（reports/*.json）并排比较；下方仍展示当前默认报告 dashboard。
        </p>
      </div>

      {reportsError ? (
        <Alert variant="destructive" className="mt-3">
          <AlertTitle>报告列表读取失败</AlertTitle>
          <AlertDescription>{reportsError}</AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive" className="mt-3">
          <AlertTitle>对比报告读取失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {onlyOne && !reportsError ? (
        <Alert className="mt-3">
          <AlertTitle>没有可对比的报告</AlertTitle>
          <AlertDescription>
            reports/ 下只有一份可用报告（{uniqueOptions[0] ?? "—"}）；对比需要至少两份。
            下方仍展示当前默认报告的 dashboard。
          </AlertDescription>
        </Alert>
      ) : null}
      {temporaryReports.length > 0 ? (
        <Alert className="mt-3">
          <AlertTitle>所选报告包含测试临时 checkpoint</AlertTitle>
          <AlertDescription>
            {temporaryReports.join("、")} 的 checkpoint 指向 pytest / 临时目录，
            属于测试产物；不要把它当作正式训练结果。可结合下方模型卡与 /api/v1/models/checkpoints 判断。
          </AlertDescription>
        </Alert>
      ) : null}

      {!reportsLoaded && !reportsError ? (
        <p role="status" className="mt-3 text-sm text-muted-foreground">
          正在读取报告列表…
        </p>
      ) : null}
      {reportsLoaded && uniqueOptions.length === 0 ? (
        <p role="status" className="mt-3 text-sm text-muted-foreground">
          暂无可用评估报告。
        </p>
      ) : null}

      {hasTwo ? (
        <>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              报告 A
              <NativeSelect value={fileA ?? ""} onChange={(event) => onSelectA(event.target.value)}>
                {uniqueOptions.map((name) => (
                  <NativeSelectOption key={name} value={name}>
                    {name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <ReportMeta
                label="A"
                file={fileA}
                report={reportA}
                currentCheckpoint={currentCheckpoint}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              报告 B
              <NativeSelect value={fileB ?? ""} onChange={(event) => onSelectB(event.target.value)}>
                {uniqueOptions.map((name) => (
                  <NativeSelectOption key={name} value={name}>
                    {name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <ReportMeta
                label="B"
                file={fileB}
                report={reportB}
                currentCheckpoint={currentCheckpoint}
              />
            </label>
          </div>

          {(loading || !reportA || !reportB) && !error ? (
            <p role="status" className="mt-3 text-sm text-muted-foreground">
              正在加载两份完整报告…
            </p>
          ) : null}

          {reportA && reportB ? (
            <>
              {comparabilityWarnings.length > 0 ? (
                <Alert className="mt-3">
                  <AlertTitle>两份报告并非同一评估设置</AlertTitle>
                  <AlertDescription>
                    {comparabilityWarnings.join("；")}。下列 B−A 只表示这两份产物的数值差异，
                    不能作为一次受控实验的比较结论。
                  </AlertDescription>
                </Alert>
              ) : null}

              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <caption className="px-1 pb-2 text-left text-xs text-muted-foreground">
                    world_model 指标：B − A 为正数表示 B 的误差更大（更差）。
                  </caption>
                  <thead>
                    <tr className="border-b border-outline-variant/50 text-left text-xs text-muted-foreground">
                      <th scope="col" className="px-2 py-1.5 font-normal">指标</th>
                      <th scope="col" className="px-2 py-1.5 text-right font-normal">A（{fileA ?? "—"}）</th>
                      <th scope="col" className="px-2 py-1.5 text-right font-normal">B（{fileB ?? "—"}）</th>
                      <th scope="col" className="px-2 py-1.5 text-right font-normal">B − A</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summaryRows.map(([key, label]) => {
                      const valueA = reportA.world_model?.[key];
                      const valueB = reportB.world_model?.[key];
                      return (
                        <tr key={key} className="border-b border-outline-variant/30 last:border-0">
                          <th scope="row" className="px-2 py-1.5 text-left font-normal">
                            {label}
                          </th>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            {formatMetric(valueA)}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            {formatMetric(valueB)}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            {formatSigned(metricDelta(valueA, valueB))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <figure className="mt-4 rounded-lg border border-outline-variant/50 bg-surface-low p-3">
                <figcaption className="mb-2">
                  <span className="block text-sm font-medium">逐特征 MAE · A vs B</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    world_model.mae_per_feature 并排对比；log 轴（不同特征量纲差异大），
                    缺失字段显示为空。
                  </span>
                </figcaption>
                {featureRows.length > 0 ? (
                  <div
                    className="w-full"
                    role="img"
                    aria-label={`逐特征 MAE 分组条形图：报告 A 与报告 B 在 ${featureRows.length} 个特征上的 world_model MAE 对比（log 轴）。`}
                  >
                    <ResponsiveContainer
                      width="100%"
                      height={Math.max(260, featureRows.length * 34 + 40)}
                    >
                      <BarChart
                        data={featureRows}
                        layout="vertical"
                        margin={{ top: 8, right: 24, left: 0, bottom: 4 }}
                      >
                        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" horizontal={false} />
                        <XAxis
                          type="number"
                          scale="log"
                          domain={["auto", "auto"]}
                          allowDataOverflow
                          tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                          tickFormatter={(value: number) => formatMetric(value, value < 1 ? 2 : 0)}
                        />
                        <YAxis
                          type="category"
                          dataKey="label"
                          width={80}
                          tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                        />
                        <Tooltip
                          contentStyle={TOOLTIP_STYLE}
                          formatter={(value, name) => [
                            formatMetric(typeof value === "number" ? value : Number(value)),
                            name === "a" ? "A" : "B",
                          ]}
                          labelFormatter={(label) => `特征：${label}`}
                        />
                        <Bar isAnimationActive={false} dataKey="a" name="a" fill={COLOR_A} radius={[0, 3, 3, 0]} barSize={10} />
                        <Bar isAnimationActive={false} dataKey="b" name="b" fill={COLOR_B} radius={[0, 3, 3, 0]} barSize={10} />
                      </BarChart>
                    </ResponsiveContainer>
                    <ul className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <li className="inline-flex items-center gap-1.5">
                        <span aria-hidden="true" className="inline-block size-2.5 rounded-sm" style={{ backgroundColor: COLOR_A }} />
                        报告 A
                      </li>
                      <li className="inline-flex items-center gap-1.5">
                        <span aria-hidden="true" className="inline-block size-2.5 rounded-sm" style={{ backgroundColor: COLOR_B }} />
                        报告 B
                      </li>
                    </ul>
                  </div>
                ) : (
                  <p className="rounded-md border border-dashed border-outline-variant/60 px-3 py-3 text-sm text-muted-foreground">
                    两份报告都缺少 world_model.mae_per_feature，无法绘制逐特征对比。
                  </p>
                )}
              </figure>

              <figure className="mt-4 rounded-lg border border-outline-variant/50 bg-surface-low p-3">
                <figcaption className="mb-2">
                  <span className="block text-sm font-medium">多步 rollout · mae_mean A vs B</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    x 轴为 rollout 预测步数（不是天数）；两报告 context_len：
                    A = {reportA.rollout?.context_len ?? "—"}，B = {reportB.rollout?.context_len ?? "—"}。
                  </span>
                </figcaption>
                {hasRollout && rolloutRows.length > 0 ? (
                  <div
                    className="h-64 w-full"
                    role="img"
                    aria-label="多步 rollout 的 mae_mean 折线图，报告 A 与报告 B 对比，x 轴为预测步数。"
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={rolloutRows} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                        <XAxis
                          dataKey="step"
                          type="category"
                          allowDuplicatedCategory={false}
                          tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                          tickFormatter={(value: number | string) => `第 ${value} 步`}
                        />
                        <YAxis
                          width={64}
                          tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                          tickFormatter={(value: number) => formatMetric(value, 1)}
                        />
                        <Tooltip
                          contentStyle={TOOLTIP_STYLE}
                          labelFormatter={(label) => `第 ${label} 步`}
                          formatter={(value, name) => [
                            formatMetric(typeof value === "number" ? value : Number(value)),
                            name === "a" ? "A mae_mean" : "B mae_mean",
                          ]}
                        />
                        <Line
                          isAnimationActive={false}
                          type="monotone"
                          dataKey="a"
                          name="a"
                          stroke={COLOR_A}
                          strokeWidth={2}
                          dot={{ r: 2.5 }}
                          connectNulls
                        />
                        <Line
                          isAnimationActive={false}
                          type="monotone"
                          dataKey="b"
                          name="b"
                          stroke={COLOR_B}
                          strokeWidth={2}
                          dot={{ r: 2.5 }}
                          connectNulls
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <p className="rounded-md border border-dashed border-outline-variant/60 px-3 py-3 text-sm text-muted-foreground">
                    至少一份报告不含 rollout.horizons，无法绘制多步对比。
                  </p>
                )}
              </figure>
            </>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
