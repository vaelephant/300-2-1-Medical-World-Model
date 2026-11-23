"use client";

import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TooltipContentProps } from "recharts";

import type {
  LatentCohortPoint,
  LatentPca,
  LatentPoint,
} from "@/lib/types";
import {
  formatNumber,
  formatPercent,
  formatSex,
  latentStageColor,
  LATENT_BCLC_ORDER,
} from "@/components/latent/latentUtils";

const TOOLTIP_STYLE = {
  background: "var(--popover)",
  color: "var(--popover-foreground)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 12,
} as const;

function isLatentPoint(value: unknown): value is LatentPoint {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as LatentPoint).step === "number"
  );
}

function LatentTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload || payload.length === 0) return null;

  const pathEntry = payload.find((entry) => isLatentPoint(entry.payload));
  if (pathEntry) {
    const point = pathEntry.payload as LatentPoint;
    return (
      <div className="rounded-md border border-border bg-popover px-2.5 py-2 text-xs text-popover-foreground shadow-sm">
        <p className="font-medium">
          {pathEntry.name === "forecast"
            ? "forecast（latent rollout）"
            : "observed（历史访视投影）"}
        </p>
        <p>
          step {point.step} · Day {formatNumber(point.day, 0)}
        </p>
        <p>
          PC1 {formatNumber(point.x, 3)} · PC2 {formatNumber(point.y, 3)}
        </p>
      </div>
    );
  }

  const cohortPoint = payload[0]?.payload as LatentCohortPoint | undefined;
  if (!cohortPoint || typeof cohortPoint.patient_id !== "string") return null;
  return (
    <div className="rounded-md border border-border bg-popover px-2.5 py-2 text-xs text-popover-foreground shadow-sm">
      <p className="font-medium">{cohortPoint.patient_id}</p>
      <p>
        BCLC {cohortPoint.bclc_stage ?? "—"} · Child-Pugh {cohortPoint.child_pugh ?? "—"}
      </p>
      <p>
        {formatSex(cohortPoint.sex)} · {formatNumber(cohortPoint.age_at_index, 0)} 岁 · 随访{" "}
        {cohortPoint.n_visits ?? "—"} 次
      </p>
      <p>
        PC1 {formatNumber(cohortPoint.x, 3)} · PC2 {formatNumber(cohortPoint.y, 3)}
      </p>
    </div>
  );
}

/** Latent PCA 散点：队列按 BCLC 着色 + 当前患者 observed/forecast 路径；点击队列点切换患者。 */
export function LatentScatter({
  cohort,
  observed,
  forecast,
  selectedId,
  pca,
  onSelect,
}: {
  cohort: LatentCohortPoint[];
  observed: LatentPoint[];
  forecast: LatentPoint[];
  selectedId: string | null;
  pca?: LatentPca;
  onSelect: (patientId: string) => void;
}) {
  const pc1 = pca?.explained_variance?.[0];
  const pc2 = pca?.explained_variance?.[1];
  const stageCounts = LATENT_BCLC_ORDER.map((stage) => ({
    stage,
    count: cohort.filter((point) => point.bclc_stage === stage).length,
  })).filter((row) => row.count > 0);

  return (
    <figure className="min-w-0 rounded-lg border border-outline-variant/50 bg-surface-lowest p-4">
      <figcaption className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium">Encoder latent · PCA 二维投影</span>
        <span className="text-xs text-muted-foreground">
          队列 {cohort.length} 点按 BCLC 着色；当前患者 observed 实线、forecast 虚线。点击队列点可切换患者。
        </span>
      </figcaption>
      <div
        className="h-[30rem] w-full"
        role="img"
        aria-label={`潜在空间 PCA 散点图：${cohort.length} 位队列患者按 BCLC 分期着色；当前患者 ${observed.length} 个 observed 点以实线连接，${forecast.length} 个 forecast 点以虚线连接；PC1 解释方差 ${formatPercent(pc1)}，PC2 解释方差 ${formatPercent(pc2)}。坐标轴无临床含义。`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 20, left: 0, bottom: 12 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis
              type="number"
              dataKey="x"
              name="PC1"
              domain={["dataMin", "dataMax"]}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              tickFormatter={(value: number) => formatNumber(value, 1)}
              label={{
                value: `PC1（${formatPercent(pc1)}）`,
                position: "insideBottom",
                offset: -4,
                fill: "var(--muted-foreground)",
                fontSize: 11,
              }}
            />
            <YAxis
              type="number"
              dataKey="y"
              name="PC2"
              domain={["dataMin", "dataMax"]}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              tickFormatter={(value: number) => formatNumber(value, 1)}
              label={{
                value: `PC2（${formatPercent(pc2)}）`,
                angle: -90,
                position: "insideLeft",
                fill: "var(--muted-foreground)",
                fontSize: 11,
              }}
            />
            <Tooltip
              cursor={{ strokeDasharray: "3 3" }}
              contentStyle={TOOLTIP_STYLE}
              content={LatentTooltip}
            />

            {/* 队列点：点击切换选中患者 */}
            <Scatter
              data={cohort}
              name="cohort"
              isAnimationActive={false}
              shape={(props) => {
                const { cx, cy, payload } = props;
                if (cx === undefined || cy === undefined || !payload) return <g />;
                const point = payload as LatentCohortPoint;
                const selected = point.patient_id === selectedId;
                return (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={selected ? 5.5 : 3}
                    fill={latentStageColor(point.bclc_stage)}
                    fillOpacity={selected ? 1 : 0.6}
                    stroke={selected ? "var(--primary)" : "var(--surface-lowest)"}
                    strokeWidth={selected ? 2 : 0.5}
                    style={{ cursor: "pointer" }}
                    onClick={() => onSelect(point.patient_id)}
                  />
                );
              }}
            />

            {/* 当前患者 observed：实线 + 点 */}
            <Scatter
              data={observed}
              name="observed"
              isAnimationActive={false}
              line={{ stroke: "var(--chart-history)", strokeWidth: 2 }}
              shape={(props) => {
                const { cx, cy } = props;
                if (cx === undefined || cy === undefined) return <g />;
                return (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={3.5}
                    fill="var(--chart-history)"
                    stroke="var(--surface-lowest)"
                    strokeWidth={1}
                  />
                );
              }}
            />

            {/* 当前患者 forecast：虚线 + 点 */}
            <Scatter
              data={forecast}
              name="forecast"
              isAnimationActive={false}
              line={{
                stroke: "var(--chart-forecast)",
                strokeWidth: 2,
                strokeDasharray: "5 4",
              }}
              shape={(props) => {
                const { cx, cy } = props;
                if (cx === undefined || cy === undefined) return <g />;
                return (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={3.5}
                    fill="var(--chart-forecast)"
                    stroke="var(--surface-lowest)"
                    strokeWidth={1}
                  />
                );
              }}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {stageCounts.map((row) => (
          <li key={row.stage} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block size-2.5 rounded-full"
              style={{ backgroundColor: latentStageColor(row.stage) }}
            />
            BCLC {row.stage} · {row.count}
          </li>
        ))}
        <li className="inline-flex items-center gap-1.5">
          <svg aria-hidden="true" width="22" height="8" viewBox="0 0 22 8" className="shrink-0">
            <line x1="0" y1="4" x2="22" y2="4" stroke="var(--chart-history)" strokeWidth="2" />
          </svg>
          observed（实线）
        </li>
        <li className="inline-flex items-center gap-1.5">
          <svg aria-hidden="true" width="22" height="8" viewBox="0 0 22 8" className="shrink-0">
            <line
              x1="0"
              y1="4"
              x2="22"
              y2="4"
              stroke="var(--chart-forecast)"
              strokeWidth="2"
              strokeDasharray="5 4"
            />
          </svg>
          forecast（虚线）
        </li>
        <li>坐标为模型内部状态投影，无临床含义</li>
      </ul>
    </figure>
  );
}
