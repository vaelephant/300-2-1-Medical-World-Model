"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type ChartPoint = {
  [key: string]: number | null | undefined;
  day: number;
  history?: number | null;
  forecast?: number | null;
  observed?: number | null;
  baseline?: number | null;
};

export type ChartScenario = { key: string; label: string; color?: string };

type Props = {
  title: string;
  data: ChartPoint[];
  unit?: string;
  originDay?: number;
  /** 只有第一张图在预测起点竖线上显示文字，其余只画线。 */
  showOriginLabel?: boolean;
  /** 同页多图共享同一个 syncId，hover 时联动 tooltip。 */
  syncId?: string;
  comparison?: boolean;
  forecastLabel?: string;
  scenarios?: ChartScenario[];
};

// 与 app/globals.css 中的 --chart-scenario-one/two/three 保持一致；
// 调用方不传颜色时按情景顺序回退，保证 2–3 个情景图例始终可区分。
export const SCENARIO_COLORS = [
  "var(--chart-scenario-one)",
  "var(--chart-scenario-two)",
  "var(--chart-scenario-three)",
] as const;

const BASELINE_LABEL = "基线 · 延续原条件";

export function FeatureChart({
  title,
  data,
  unit,
  originDay,
  showOriginLabel = false,
  syncId,
  comparison,
  forecastLabel,
  scenarios = [],
}: Props) {
  return (
    <div className="rounded-lg border border-outline-variant/50 bg-surface-lowest p-4 shadow-xs">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-on-surface">{title}</h3>
        <span className="text-xs text-on-surface-variant">
          {unit ? `${unit} · ` : ""}横轴：相对诊断日
        </span>
      </div>
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            syncId={syncId}
            margin={{ top: 8, right: 8, left: 0, bottom: 4 }}
          >
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis
              dataKey="day"
              type="number"
              domain={["dataMin", "dataMax"]}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            />
            <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} width={48} />
            <Tooltip
              contentStyle={{
                background: "var(--popover)",
                color: "var(--popover-foreground)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            <Line
              isAnimationActive={false}
              type="linear"
              dataKey="history"
              name="输入历史"
              stroke="var(--chart-history)"
              strokeWidth={2}
              dot={{ r: 3 }}
              connectNulls={true}
            />
            <Line
              isAnimationActive={false}
              type="linear"
              dataKey="forecast"
              name={forecastLabel ?? BASELINE_LABEL}
              stroke="var(--chart-forecast)"
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={{ r: 2.5 }}
              connectNulls={true}
            />
            {comparison && (
              <Line
                isAnimationActive={false}
                type="linear"
                dataKey="baseline"
                name="延续原条件"
                stroke="var(--chart-baseline)"
                strokeDasharray="6 4"
                strokeWidth={2}
                connectNulls
                dot={{ r: 2 }}
              />
            )}
            {originDay !== undefined && (
              <ReferenceLine
                x={originDay}
                stroke="var(--primary)"
                strokeDasharray="4 4"
                label={
                  showOriginLabel
                    ? {
                        value: "预测起点",
                        fill: "var(--primary)",
                        fontSize: 11,
                        position: "insideTopRight",
                      }
                    : undefined
                }
              />
            )}
            {scenarios.map((scenario, index) => (
              <Line
                key={scenario.key}
                isAnimationActive={false}
                type="linear"
                dataKey={scenario.key}
                name={scenario.label}
                stroke={scenario.color ?? SCENARIO_COLORS[index % SCENARIO_COLORS.length]}
                strokeWidth={2}
                dot={{ r: 2 }}
                connectNulls
              />
            ))}
            <Line
              isAnimationActive={false}
              type="linear"
              dataKey="observed"
              name="后续观测（未输入）"
              stroke="var(--chart-observed)"
              strokeDasharray="2 4"
              strokeWidth={2}
              connectNulls
              dot={{ r: 2.5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

type ChartLegendProps = {
  /** 是否显示“基线 · 延续原条件”条目（未运行预测时不存在这条线）。 */
  showBaseline?: boolean;
  baselineLabel?: string;
  /** 后续观测仅在揭示后才出现。 */
  revealed?: boolean;
  scenarios?: ChartScenario[];
};

function LegendLine({ color, dash }: { color: string; dash?: string }) {
  return (
    <svg
      aria-hidden="true"
      width="22"
      height="8"
      viewBox="0 0 22 8"
      className="shrink-0 overflow-visible"
    >
      <line
        x1="0"
        y1="4"
        x2="22"
        y2="4"
        stroke={color}
        strokeWidth="2"
        strokeDasharray={dash}
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * 四张指标图共享的图例，只在图表网格上方渲染一次。
 * 线型与图表保持一致：历史实线 / 基线虚线 / 情景实线 / 后续观测点线。
 */
export function ChartLegend({
  showBaseline = true,
  baselineLabel = BASELINE_LABEL,
  revealed = false,
  scenarios = [],
}: ChartLegendProps) {
  const items: Array<{ label: string; color: string; dash?: string }> = [
    { label: "输入历史", color: "var(--chart-history)" },
  ];

  if (showBaseline) {
    items.push({ label: baselineLabel, color: "var(--chart-forecast)", dash: "6 4" });
  }

  scenarios.forEach((scenario, index) => {
    items.push({
      label: scenario.label,
      color: scenario.color ?? SCENARIO_COLORS[index % SCENARIO_COLORS.length],
    });
  });

  if (revealed) {
    items.push({
      label: "后续观测（未输入）",
      color: "var(--chart-observed)",
      dash: "2 4",
    });
  }

  return (
    <ul
      aria-label="图表图例"
      className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground"
    >
      {items.map((item) => (
        <li key={item.label} className="inline-flex items-center gap-1.5">
          <LegendLine color={item.color} dash={item.dash} />
          <span>{item.label}</span>
        </li>
      ))}
    </ul>
  );
}
