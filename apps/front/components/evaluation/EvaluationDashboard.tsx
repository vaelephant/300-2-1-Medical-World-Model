"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TooltipContentProps } from "recharts";

import type { ModelMeta } from "@/lib/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  buildFeatureErrorRows,
  buildRolloutPoints,
  FEATURE_LABELS,
  formatMetric,
  formatSigned,
  type FeatureErrorRow,
  type FullEvalReport,
  type RolloutPoint,
} from "@/components/evaluation/types";

const TOOLTIP_STYLE = {
  background: "var(--popover)",
  color: "var(--popover-foreground)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 12,
} as const;

function difference(model?: number | null, base?: number | null): number | null {
  if (
    model === undefined ||
    model === null ||
    base === undefined ||
    base === null ||
    !Number.isFinite(model) ||
    !Number.isFinite(base)
  ) {
    return null;
  }
  return model - base;
}

function metaConfigValue(meta: ModelMeta | null, key: string): string {
  const value = meta?.config?.[key];
  if (value === undefined || value === null) return "—";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "number") return formatMetric(value, 0);
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function BeatBadge({ label, beats }: { label: string; beats?: boolean }) {
  const state = beats === true ? "ok" : beats === false ? "bad" : "neutral";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
        state === "ok" && "border-tertiary/40 bg-tertiary-container/60 text-tertiary",
        state === "bad" && "border-error/40 bg-error-container/50 text-error",
        state === "neutral" && "border-outline-variant bg-surface-low text-muted-foreground",
      )}
    >
      <span aria-hidden="true">{beats === true ? "✓" : beats === false ? "✕" : "?"}</span>
      <span className="font-medium">{label}</span>
      <span className="text-[0.65rem]">{beats === true ? "优于" : beats === false ? "未优于" : "未提供"}</span>
    </span>
  );
}

function KpiCard({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-outline-variant/50 bg-surface-lowest px-4 py-3">
      <p className="text-xs text-on-surface-variant">{label}</p>
      <div className="mt-1 text-sm text-on-surface">{children}</div>
      {hint ? <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function FeatureTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload as FeatureErrorRow | undefined;
  if (!row) return null;
  return (
    <div className="rounded-md border border-border bg-popover px-2.5 py-2 text-xs text-popover-foreground shadow-sm">
      <p className="font-medium">{row.label}</p>
      <p>模型 MAE：{formatMetric(row.model)}</p>
      <p>Persistence MAE：{formatMetric(row.base)}</p>
      <p>
        比值：{formatMetric(row.ratio, 3)}（
        {row.ratio < 1 ? "模型误差更小" : row.ratio > 1 ? "模型误差更大" : "持平"}）
      </p>
    </div>
  );
}

function FeatureErrorFigure({ rows }: { rows: FeatureErrorRow[] }) {
  const height = Math.max(260, rows.length * 30 + 56);
  return (
    <figure className="rounded-lg border border-outline-variant/50 bg-surface-lowest p-4">
      <figcaption className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="text-sm font-medium">逐特征 MAE：模型 / Persistence 比值</span>
        <span className="text-xs text-muted-foreground">
          条形长度 = 模型 MAE ÷ 基线 MAE；&lt; 1 表示该特征上模型误差更小，&gt; 1 表示更大；
          虚线 = 比值 1（与 Persistence 持平）。用比值避免把量纲差异很大的 MAE 直接相加比较。
        </span>
      </figcaption>
      {rows.length > 0 ? (
        <div
          role="img"
          aria-label={`逐特征 MAE 模型与 Persistence 比值横向条形图，共 ${rows.length} 个特征；比值小于 1 表示模型误差更小。`}
        >
          <ResponsiveContainer width="100%" height={height}>
            <BarChart
              data={rows}
              layout="vertical"
              margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
            >
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" horizontal={false} />
              <XAxis
                type="number"
                dataKey="ratio"
                domain={[0, "dataMax"]}
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                tickFormatter={(value: number) => value.toFixed(2)}
              />
              <YAxis
                type="category"
                dataKey="label"
                width={76}
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              />
              <ReferenceLine x={1} stroke="var(--outline)" strokeDasharray="4 4" />
              <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.4 }} content={FeatureTooltip} />
              <Bar dataKey="ratio" barSize={12} radius={[0, 4, 4, 0]}>
                {rows.map((row) => (
                  <Cell
                    key={row.key}
                    fill={row.ratio <= 1 ? "var(--chart-history)" : "var(--error)"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="rounded-md border border-dashed border-outline-variant/60 px-3 py-4 text-sm text-muted-foreground">
          报告未提供逐特征 MAE，无法绘制该图。
        </p>
      )}
    </figure>
  );
}

function RolloutTrendFigure({
  title,
  subtitle,
  points,
  dataKey,
  color,
  ariaLabel,
}: {
  title: string;
  subtitle: string;
  points: RolloutPoint[];
  dataKey: "maeMean" | "maeExAfp";
  color: string;
  ariaLabel: string;
}) {
  const hasData = points.some((point) => point[dataKey] !== null);
  return (
    <figure className="rounded-lg border border-outline-variant/50 bg-surface-lowest p-4">
      <figcaption className="mb-3">
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{subtitle}</span>
      </figcaption>
      {hasData ? (
        <div className="h-56 w-full" role="img" aria-label={ariaLabel}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis
                dataKey="step"
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                tickFormatter={(value: number) => `第 ${value} 步`}
              />
              <YAxis
                width={56}
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                tickFormatter={(value: number) => formatMetric(value, 1)}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                labelFormatter={(label) => `预测第 ${label} 步`}
                formatter={(value) => [
                  formatMetric(typeof value === "number" ? value : Number(value)),
                  "MAE",
                ]}
              />
              <Line
                isAnimationActive={false}
                type="monotone"
                dataKey={dataKey}
                name={title}
                stroke={color}
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="rounded-md border border-dashed border-outline-variant/60 px-3 py-4 text-sm text-muted-foreground">
          报告未提供该指标的多步 rollout 数据。
        </p>
      )}
    </figure>
  );
}

export function EvaluationDashboard({
  report,
  meta,
}: {
  report: FullEvalReport;
  meta: ModelMeta | null;
}) {
  const worldModel = report.world_model;
  const persistence = report.persistence;
  const featureRows = buildFeatureErrorRows(report);
  // 表格保留报告里的全部特征（即使缺少基线值也不隐藏），图表只用可比对的行。
  const featureTableRows = Object.entries(worldModel?.mae_per_feature ?? {}).map(
    ([key, modelMae]) => {
      const baseMae = persistence?.mae_per_feature?.[key];
      const ratio =
        Number.isFinite(baseMae) && (baseMae as number) > 0 ? modelMae / (baseMae as number) : null;
      return {
        key,
        label: FEATURE_LABELS[key] ?? key,
        model: modelMae,
        base: baseMae,
        ratio,
      };
    },
  );
  const rolloutPoints = buildRolloutPoints(report);
  const checkpoint = meta?.checkpoint ?? report.checkpoint ?? "—";
  const reportVersion = report.model_version;
  const servingVersion = meta?.model_version;
  const versionMismatch = Boolean(
    reportVersion && servingVersion && reportVersion !== servingVersion,
  );
  const maeDelta = difference(worldModel?.mae_mean, persistence?.mae_mean);
  const macroDelta = difference(worldModel?.mae_macro, persistence?.mae_macro);
  const exAfpDelta = difference(worldModel?.mae_ex_afp, persistence?.mae_ex_afp);
  const contextLen = report.rollout?.context_len;

  return (
    <div className="flex flex-col gap-6">
      <Alert>
        <AlertTitle>指标解释</AlertTitle>
        <AlertDescription>
          各特征单位不同，汇总 MAE 只能作为工程诊断，不能视作统一临床评分。AFP 数值尺度大，
          mae_mean 易被 AFP 主导；请同时看 mae_macro、mae_ex_afp 与逐特征误差。以下数字来自真实评估产物
          （/api/v1/evaluations），
          {report.data_source === "synthetic" ? "合成数据指标" : "数据指标"} ≠ 临床性能。
        </AlertDescription>
      </Alert>

      {/* KPI：全部来自报告字段，不换算百分比、不伪造数据 */}
      <section aria-label="评估关键指标" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="评估范围（真实测试集）"
          hint={
            <>
              有效样本（逐特征非缺失累计）：{formatMetric(worldModel?.n_valid, 0)}
              {report.research_only === false ? "" : " · research_only"}
            </>
          }
        >
          <p className="font-medium">
            {report.split ?? "—"} · {report.n_patients ?? "—"} 位患者 ·{" "}
            {report.data_source ?? "—"}
          </p>
        </KpiCard>

        <KpiCard label="vs Persistence 结论" hint="三个口径分别判定，均按报告中的 beats_persistence_* 字段">
          <div className="flex flex-wrap gap-1.5">
            <BeatBadge label="含 AFP" beats={report.beats_persistence_mae} />
            <BeatBadge label="宏平均" beats={report.beats_persistence_mae_macro} />
            <BeatBadge label="排除 AFP" beats={report.beats_persistence_mae_ex_afp} />
          </div>
        </KpiCard>

        <KpiCard
          label="MAE（排除 AFP）"
          hint={
            <>
              模型 − 基线：{formatSigned(exAfpDelta)}（负数表示模型误差更小）
            </>
          }
        >
          <p className="font-medium tabular-nums">
            模型 {formatMetric(worldModel?.mae_ex_afp)} / 基线{" "}
            {formatMetric(persistence?.mae_ex_afp)}
          </p>
        </KpiCard>

        <KpiCard
          label="MAE 绝对差（模型 − 基线）"
          hint="正数表示模型误差更大；这是按原始 MAE 单位计算的绝对差，不是百分比。"
        >
          <p className="tabular-nums">
            含 AFP（mae_mean）：<span className="font-medium">{formatSigned(maeDelta)}</span>
          </p>
          <p className="tabular-nums">
            宏平均（mae_macro）：<span className="font-medium">{formatSigned(macroDelta)}</span>
          </p>
        </KpiCard>
      </section>

      {/* 模型卡 / provenance：字段全部来自 /api/v1/models 与 /api/v1/evaluations */}
      <section aria-label="模型卡与 provenance" className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-outline-variant/50 bg-surface-lowest p-4">
          <h2 className="text-sm font-medium">模型卡 · provenance</h2>
          <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">模型版本</dt>
              <dd className="mt-0.5 font-medium">{meta?.model_version ?? report.model_version ?? "—"}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">Checkpoint</dt>
              <dd className="mt-0.5 truncate font-mono text-xs" title={checkpoint}>
                {checkpoint}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">推理设备</dt>
              <dd className="mt-0.5">{meta?.device ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">已加载队列患者数</dt>
              <dd className="mt-0.5 tabular-nums">{formatMetric(meta?.n_patients_loaded, 0)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">报告数据来源</dt>
              <dd className="mt-0.5">{report.data_source ?? meta?.data_source ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">研究用途标记</dt>
              <dd className="mt-0.5">
                {report.research_only === false ? "—" : "research_only（非临床）"}
              </dd>
            </div>
          </dl>
          {versionMismatch ? (
            <p className="mt-3 text-xs text-warning">
              评估报告版本（{reportVersion}）与当前推理服务版本（{servingVersion}）不一致，
              报告可能对应旧权重；请以同一次训练 / 评估产物为准。
            </p>
          ) : null}
          {meta === null ? (
            <p className="mt-3 text-xs text-warning">
              模型服务不可用：推理设备 / 已加载队列 / 配置显示为 —，但评估报告本身仍来自
              /api/v1/evaluations，不影响下列误差证据。
            </p>
          ) : null}
        </div>

        <div className="rounded-lg border border-outline-variant/50 bg-surface-lowest p-4">
          <h2 className="text-sm font-medium">训练 / 模型配置</h2>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">hidden_dim</dt>
              <dd className="mt-0.5 tabular-nums">{metaConfigValue(meta, "hidden_dim")}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">latent_dim</dt>
              <dd className="mt-0.5 tabular-nums">{metaConfigValue(meta, "latent_dim")}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">residual</dt>
              <dd className="mt-0.5">{metaConfigValue(meta, "residual")}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">max_visits</dt>
              <dd className="mt-0.5 tabular-nums">{metaConfigValue(meta, "max_visits")}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">
            模型卡字段来自 /api/v1/models（checkpoint 内 config 子集），评估数值来自
            /api/v1/evaluations（reports/*.json），前端不硬编码。
          </p>
        </div>
      </section>

      <FeatureErrorFigure rows={featureRows} />

      <section aria-label="多步 rollout 误差" className="grid gap-4 lg:grid-cols-2">
        <RolloutTrendFigure
          title="各预测步 MAE（含 AFP）"
          subtitle={`x 轴为 rollout 预测步数（第 1 步 … 第 N 步），context = ${contextLen ?? "—"} 次随访；mae_mean 易被 AFP 尺度的特征主导。`}
          points={rolloutPoints}
          dataKey="maeMean"
          color="var(--chart-forecast)"
          ariaLabel="各预测步包含 AFP 的 MAE 折线图，x 轴为 rollout 预测步数。"
        />
        <RolloutTrendFigure
          title="各预测步特征 MAE 均值（排除 AFP）"
          subtitle="由每步逐特征 MAE 中除 AFP 外的特征取均值重算，与汇总表 mae_ex_afp 口径一致；Persistence 无逐步 rollout 数据，未在此图对比。"
          points={rolloutPoints}
          dataKey="maeExAfp"
          color="var(--chart-history)"
          ariaLabel="各预测步排除 AFP 后特征 MAE 均值的折线图，x 轴为 rollout 预测步数。"
        />
      </section>

      <section className="flex flex-col gap-3" aria-label="评估证据明细">
        <h2 className="text-lg font-semibold">证据明细</h2>

        <Table>
          <TableCaption>
            Persistence：保持末次观测值的基线。差值 = 模型 − 基线，负数表示模型误差更小。
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>汇总指标</TableHead>
              <TableHead>世界模型</TableHead>
              <TableHead>Persistence</TableHead>
              <TableHead>模型 − 基线</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(
              [
                ["mae_mean", "总体 MAE（含 AFP）"],
                ["mae_macro", "特征 MAE 均值（未标准化）"],
                ["mae_ex_afp", "MAE（排除 AFP）"],
              ] as const
            ).map(([key, label]) => {
              const model = worldModel?.[key];
              const base = persistence?.[key];
              return (
                <TableRow key={key}>
                  <TableCell>{label}</TableCell>
                  <TableCell className="tabular-nums">{formatMetric(model)}</TableCell>
                  <TableCell className="tabular-nums">{formatMetric(base)}</TableCell>
                  <TableCell className="tabular-nums">
                    {formatSigned(difference(model, base))}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        <Table>
          <TableCaption>
            逐特征误差；比值 = 模型 MAE ÷ 基线 MAE，&lt; 1 表示该特征上模型误差更小。
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>特征</TableHead>
              <TableHead>模型 MAE</TableHead>
              <TableHead>基线 MAE</TableHead>
              <TableHead>比值</TableHead>
              <TableHead>模型 RMSE</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {featureTableRows.map((row) => (
              <TableRow key={row.key}>
                <TableCell>{row.label}</TableCell>
                <TableCell className="tabular-nums">{formatMetric(row.model)}</TableCell>
                <TableCell className="tabular-nums">{formatMetric(row.base)}</TableCell>
                <TableCell className="tabular-nums">{formatMetric(row.ratio, 3)}</TableCell>
                <TableCell className="tabular-nums">
                  {formatMetric(worldModel?.rmse_per_feature?.[row.key])}
                </TableCell>
              </TableRow>
            ))}
            {featureTableRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">
                  报告未提供逐特征误差。
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>

        <Table>
          <TableCaption>
            多步 rollout：context = {contextLen ?? "未知"} 次随访；每步「排除 AFP」由逐特征 MAE 重算。
            未提供的数据显示为 —，不会按零展示。
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>预测步数</TableHead>
              <TableHead>MAE（含 AFP）</TableHead>
              <TableHead>MAE（排除 AFP，重算）</TableHead>
              <TableHead>AFP MAE</TableHead>
              <TableHead>肿瘤直径 MAE</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rolloutPoints.map((point) => {
              const metrics = report.rollout?.horizons?.[String(point.step)];
              return (
                <TableRow key={point.step}>
                  <TableCell>第 {point.step} 步</TableCell>
                  <TableCell className="tabular-nums">{formatMetric(point.maeMean)}</TableCell>
                  <TableCell className="tabular-nums">{formatMetric(point.maeExAfp)}</TableCell>
                  <TableCell className="tabular-nums">
                    {formatMetric(metrics?.mae_per_feature?.afp)}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {formatMetric(metrics?.mae_per_feature?.tumor_size_cm)}
                  </TableCell>
                </TableRow>
              );
            })}
            {rolloutPoints.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">
                  报告未提供多步 rollout 数据。
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>

        <p className="text-xs text-muted-foreground">
          特征映射：{Object.entries(FEATURE_LABELS).map(([key, label]) => `${key}=${label}`).join("，")}；
          未在映射中的特征直接显示原始 key。
        </p>
      </section>
    </div>
  );
}
