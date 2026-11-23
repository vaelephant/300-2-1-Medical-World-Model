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

import {
  BCLC_STAGES,
  formatNumber,
  stageColor,
  type ScatterDatum,
} from "@/components/cohort/cohortUtils";

const TOOLTIP_STYLE = {
  background: "var(--popover)",
  color: "var(--popover-foreground)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 12,
} as const;

function ScatterTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload as ScatterDatum | undefined;
  if (!row) return null;
  return (
    <div className="rounded-md border border-border bg-popover px-2.5 py-2 text-xs text-popover-foreground shadow-sm">
      <p className="font-medium">{row.id}</p>
      <p>
        BCLC {row.stage} · Child-Pugh {row.childPugh}
      </p>
      <p>基线肿瘤直径：{formatNumber(row.x)} cm</p>
      <p>基线 AFP：{formatNumber(row.afp, 1)} ng/mL</p>
      <p>log10(AFP)：{formatNumber(row.y, 2)}</p>
    </div>
  );
}

/** 队列散点：x=基线肿瘤直径，y=log10(基线 AFP)，颜色=BCLC；点击圆点切换选中患者。 */
export function CohortScatter({
  data,
  selectedId,
  onSelect,
}: {
  data: ScatterDatum[];
  selectedId: string | null;
  onSelect: (patientId: string) => void;
}) {
  const stageCounts = BCLC_STAGES.map((stage) => ({
    stage,
    count: data.filter((row) => row.stage === stage).length,
  })).filter((row) => row.count > 0);

  return (
    <figure className="min-w-0 rounded-lg border border-outline-variant/50 bg-surface-lowest p-4">
      <figcaption className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium">基线肿瘤直径 vs log10(AFP)</span>
        <span className="text-xs text-muted-foreground">
          颜色 = BCLC 分期；点击圆点选中患者；AFP ≤ 0 / 缺失不显示。点位只表示描述统计，不是模型输出。
        </span>
      </figcaption>
      <div
        className="h-80 w-full"
        role="img"
        aria-label={`队列散点图：${data.length} 位患者在基线肿瘤直径与 log10(AFP) 平面上的分布，按 BCLC 分期着色；点击圆点可选中患者。`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis
              type="number"
              dataKey="x"
              name="基线肿瘤直径 (cm)"
              domain={["dataMin", "dataMax"]}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              tickFormatter={(value: number) => value.toFixed(1)}
              label={{
                value: "基线肿瘤直径 (cm)",
                position: "insideBottom",
                offset: -2,
                fill: "var(--muted-foreground)",
                fontSize: 11,
              }}
            />
            <YAxis
              type="number"
              dataKey="y"
              name="log10(AFP)"
              domain={["dataMin", "dataMax"]}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              tickFormatter={(value: number) => value.toFixed(1)}
              label={{
                value: "log10(AFP)",
                angle: -90,
                position: "insideLeft",
                fill: "var(--muted-foreground)",
                fontSize: 11,
              }}
            />
            <Tooltip
              cursor={{ strokeDasharray: "3 3" }}
              contentStyle={TOOLTIP_STYLE}
              content={ScatterTooltip}
            />
            <Scatter
              data={data}
              isAnimationActive={false}
              shape={(props) => {
                const { cx, cy, payload } = props;
                if (cx === undefined || cy === undefined || !payload) return <g />;
                const row = payload as ScatterDatum;
                const selected = row.id === selectedId;
                return (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={selected ? 5 : 3}
                    fill={stageColor(row.stage)}
                    fillOpacity={selected ? 1 : 0.65}
                    stroke={selected ? "var(--primary)" : "var(--surface-lowest)"}
                    strokeWidth={selected ? 2 : 0.5}
                    style={{ cursor: "pointer" }}
                    onClick={() => onSelect(row.id)}
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
              style={{ backgroundColor: stageColor(row.stage) }}
            />
            BCLC {row.stage} · {row.count}
          </li>
        ))}
        <li>共 {data.length} 个点（AFP &gt; 0 且基线肿瘤直径有效）</li>
      </ul>
    </figure>
  );
}
